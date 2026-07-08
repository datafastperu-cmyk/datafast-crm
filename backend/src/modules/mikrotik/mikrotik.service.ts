import {
  Injectable, Logger, NotFoundException, OnModuleInit,
  BadRequestException, ConflictException, InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ModuleHealthService } from '../../common/services/module-health.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In }   from 'typeorm';
import { InjectDataSource }  from '@nestjs/typeorm';
import { DataSource }        from 'typeorm';
import { EventEmitter2 as EventEmitter } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import * as net from 'net';

import { Router, VersionRouterOS, EstadoEquipo, TipoControl, TipoControlVelocidad, MetodoConexion } from './entities/router.entity';
import { RouterConnectionPool, RouterCredentials } from './services/connection-pool.service';
import { PppoeService, CreatePppoeParams }         from './services/pppoe.service';
import { QueueService, QueueParams }               from './services/queue.service';
import { FirewallService }                          from './services/firewall.service';
import { ArpService }                              from './services/arp.service';
import { InterfaceService }                        from './services/interface.service';
import { SubnetRouteService }                      from './services/subnet-route.service';
import { AuditoriaService }                        from '../auth/auditoria.service';
import { VpnClienteService }                       from '../openvpn/services/vpn-cliente.service';
import { JwtPayload }                              from '../../common/decorators/current-user.decorator';
import { encrypt, decrypt }                        from '../../common/utils/encryption.util';

import {
  CreateRouterDto, UpdateRouterDto, ProvisionarClienteDto,
  SuspenderClienteDto, ReactivarClienteDto, AmareIpMacDto,
  TestConexionDirectaDto, ActualizarQueueDto,
} from './dto/mikrotik.dto';

import { NOTIFICATION_EVENTS } from '../notificaciones/events/notification.events';

// ─── Evento emitido al suspender/reactivar ────────────────────
export const EVENT_CLIENTE_SUSPENDIDO  = 'mikrotik.cliente.suspendido';
export const EVENT_CLIENTE_REACTIVADO  = 'mikrotik.cliente.reactivado';

@Injectable()
export class MikrotikService implements OnModuleInit {
  private readonly logger = new Logger(MikrotikService.name);
  private readonly reglasOk = new Set<string>();

  private degraded      = false;
  private degradedReason: string | null = null;

  // Contador de fallos consecutivos de poll por router (en memoria).
  // 1 fallo → REVERIFICANDO (puede ser transitorio), 2+ fallos → OFFLINE real.
  private readonly _pollFailCount = new Map<string, number>();
  private          _pollRunning   = false;

  constructor(
    @InjectRepository(Router)
    private readonly routerRepo:  Repository<Router>,
    private readonly pool:        RouterConnectionPool,
    private readonly pppoeSvc:    PppoeService,
    private readonly queueSvc:    QueueService,
    private readonly firewallSvc: FirewallService,
    private readonly arpSvc:      ArpService,
    private readonly ifaceSvc:    InterfaceService,
    private readonly subnetSvc:   SubnetRouteService,
    private readonly auditoria:   AuditoriaService,
    private readonly events:      EventEmitter,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly vpnSvc:      VpnClienteService,
    private readonly moduleHealth: ModuleHealthService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      // Probe 1: tabla accesible en BD
      await this.ds.query(`SELECT 1 FROM routers LIMIT 0`);

      // Probe 2: ping TCP al primer router online (timeout 3s)
      // Si no hay ninguno, el módulo arranca OK igualmente.
      const [primer] = await this.ds.query<any[]>(`
        SELECT ip_gestion AS ip, vpn_ip AS "vpnIp",
               puerto_api AS puerto, usar_ssl AS "usarSsl", puerto_api_ssl AS "puertoApiSsl"
        FROM routers
        WHERE estado = 'online' AND deleted_at IS NULL
        LIMIT 1
      `);

      if (primer) {
        const ip    = primer.vpnIp || primer.ip;
        const port  = primer.usarSsl ? (primer.puertoApiSsl ?? 8729) : (primer.puerto ?? 8728);
        await new Promise<void>((resolve, reject) => {
          const s = net.createConnection({ host: ip, port }, resolve);
          s.setTimeout(3000, () => { s.destroy(); reject(new Error(`TCP timeout ${ip}:${port}`)); });
          s.on('error', reject);
          s.on('connect', () => s.destroy());
        });
      }

      this.moduleHealth.registrar('mikrotik', 'ok');
    } catch (err: any) {
      // Degraded pero NO crashear — otros módulos del core deben seguir operando
      this.degraded       = true;
      this.degradedReason = err.message;
      this.moduleHealth.registrar('mikrotik', 'degraded', err.message);
    }
  }

  isDegraded():        boolean       { return this.degraded; }
  getDegradedReason(): string | null { return this.degradedReason; }

  private assertNotDegraded(): void {
    if (this.degraded) {
      throw new ServiceUnavailableException(
        `Módulo MikroTik no disponible: ${this.degradedReason ?? 'error de esquema en BD'}`,
      );
    }
  }

  // ────────────────────────────────────────────────────────────
  // GESTIÓN DE ROUTERS
  // ────────────────────────────────────────────────────────────

  async crearRouter(dto: CreateRouterDto, user: JwtPayload): Promise<Router> {
    const passwordCifrado = encrypt(dto.password);

    // Validar unicidad de IP de gestión
    const existePorIp = await this.routerRepo.findOne({
      where: { ipGestion: dto.ipGestion, empresaId: user.empresaId, deletedAt: null as any },
    });
    if (existePorIp) {
      throw new BadRequestException(`La IP de gestión ${dto.ipGestion} ya está registrada en esta empresa`);
    }

    // Validar unicidad de nombre
    const existePorNombre = await this.routerRepo.findOne({
      where: { nombre: dto.nombre, empresaId: user.empresaId, deletedAt: null as any },
    });
    if (existePorNombre) {
      throw new ConflictException(`Ya existe un router con el nombre "${dto.nombre}"`);
    }

    // Validar unicidad de IP VPN
    if (dto.vpnIp && dto.vpnIp !== dto.ipGestion) {
      const existePorVpnIp = await this.routerRepo.findOne({
        where: { vpnIp: dto.vpnIp, empresaId: user.empresaId, deletedAt: null as any },
      });
      if (existePorVpnIp) {
        throw new BadRequestException(`La IP VPN ${dto.vpnIp} ya está registrada en esta empresa`);
      }
    }

    const { password: _pw, vpnClienteId: _vpnClienteId, ...dtoRest } = dto;
    const router = this.routerRepo.create({
      ...dtoRest,
      passwordCifrado,
      empresaId: user.empresaId,
      estado:    EstadoEquipo.DESCONOCIDO,
    });
    const saved = await this.routerRepo.save(router);

    if (dto.metodoConexion === MetodoConexion.VPN_TUNNEL) {
      if (dto.vpnClienteId) {
        // Vincular cert del wizard directamente — evita generar un cert UUID huérfano.
        // Pasamos usuarioId para asegurar que el cert pertenece al operador que abrió el wizard.
        try {
          await this.vpnSvc.vincularCertWizardARouter(dto.vpnClienteId, saved.id, user.empresaId, user.sub);
        } catch (e: any) {
          this.logger.error(`[VPN-CCD] vincular wizard cert router ${saved.id}: ${e.message}`);
          await this.routerRepo.softDelete(saved.id);
          throw new InternalServerErrorException(
            `Router creado pero falló la configuración VPN: ${e.message}. El registro fue revertido.`,
          );
        }
      } else {
        this.vpnSvc.generarParaRouter(await this.findOne(saved.id, user.empresaId)).catch(e =>
          this.logger.error(`[VPN-CCD] generarParaRouter falló para router ${saved.id} — vpnCommonName quedará null hasta el próximo "Reparar": ${e.message}`)
        );
      }
    }

    await this.auditoria.logCreate({
      empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      modulo: 'mikrotik', entidadId: saved.id,
      descripcion: `Router creado: ${dto.nombre} (${dto.ipGestion})`,
    });

    // Sincronizar subnets LAN del router (async, no bloquea la respuesta)
    this.syncSubnetsAsync(saved);

    // Detectar versión y marcar ONLINE antes de responder al frontend (máx 5s).
    // Si el router no responde en ese tiempo, quedará en DESCONOCIDO y el cron
    // de métricas lo actualizará en los próximos 5 minutos.
    await Promise.race([
      this.detectarVersionAsync(saved),
      new Promise<void>((r) => setTimeout(r, 5000)),
    ]);

    // Recargar entidad con el estado actualizado para retornarlo al frontend
    const routerFinal = await this.findOne(saved.id, user.empresaId);
    this.inyectarReglasMorososAsync(routerFinal);
    return routerFinal;
  }

  async findAll(empresaId: string, tipoServicio?: string): Promise<(Router & { contratosCount: number })[]> {
    let routerIds: string[] | null = null;

    if (tipoServicio) {
      const segRows: { router_id: string }[] = await this.ds.query(
        `SELECT DISTINCT router_id
         FROM segmentos_ipv4
         WHERE empresa_id = $1
           AND activo = true
           AND deleted_at IS NULL
           AND router_id IS NOT NULL
           AND tipo_servicio = $2`,
        [empresaId, tipoServicio],
      );
      routerIds = segRows.map((r) => r.router_id);
      if (!routerIds.length) return [];
    }

    const routers = await this.routerRepo.find({
      where: {
        empresaId,
        activo: true,
        deletedAt: null as any,
        ...(routerIds ? { id: In(routerIds) } : {}),
      },
      order: { nombre: 'ASC' },
    });
    if (!routers.length) return [];

    const rows: { router_id: string; count: string }[] = await this.ds.query(
      `SELECT router_id, COUNT(*) AS count
       FROM contratos
       WHERE router_id = ANY($1)
         AND estado IN ('activo','suspendido')
         AND deleted_at IS NULL
       GROUP BY router_id`,
      [routers.map((r) => r.id)],
    );

    const countMap = new Map(rows.map((r) => [r.router_id, Number(r.count)]));
    return routers.map((r) => Object.assign(r, { contratosCount: countMap.get(r.id) ?? 0 }));
  }

  async findOne(id: string, empresaId: string): Promise<Router> {
    const r = await this.routerRepo.findOne({ where: { id, empresaId, deletedAt: null as any } });
    if (!r) throw new NotFoundException(`Router ${id} no encontrado`);
    return r;
  }

  async updateRouter(id: string, dto: UpdateRouterDto, user: JwtPayload): Promise<Router> {
    await this.findOne(id, user.empresaId);

    if (dto.ipGestion) {
      const existePorIp = await this.routerRepo.findOne({
        where: { ipGestion: dto.ipGestion, empresaId: user.empresaId, deletedAt: null as any },
      });
      if (existePorIp && existePorIp.id !== id) {
        throw new BadRequestException(`La IP de gestión ${dto.ipGestion} ya está registrada en esta empresa`);
      }
    }
    if (dto.nombre) {
      const existePorNombre = await this.routerRepo.findOne({
        where: { nombre: dto.nombre, empresaId: user.empresaId, deletedAt: null as any },
      });
      if (existePorNombre && existePorNombre.id !== id) {
        throw new ConflictException(`Ya existe un router con el nombre "${dto.nombre}"`);
      }
    }
    if (dto.vpnIp) {
      const existePorVpnIp = await this.routerRepo.findOne({
        where: { vpnIp: dto.vpnIp, empresaId: user.empresaId, deletedAt: null as any },
      });
      if (existePorVpnIp && existePorVpnIp.id !== id) {
        throw new BadRequestException(`La IP VPN ${dto.vpnIp} ya está registrada en esta empresa`);
      }
    }

    const { password: rawPass, vpnClienteId: _vpnClienteId, ...dtoRest } = dto as any;
    const updates: Partial<Router> = { ...dtoRest };
    if (rawPass && rawPass !== '***stored***') {
      updates.passwordCifrado = encrypt(rawPass);
    }
    // vpn_common_name es inmutable — identifica el túnel en el servidor OpenVPN.
    delete (updates as any).vpnCommonName;

    await this.routerRepo.update(id, updates);
    // Invalidar conexiones existentes si cambió la IP o contraseña
    if (dto.ipGestion || (dto as any).password) {
      await this.pool.invalidate(id);
    }
    const updated = await this.findOne(id, user.empresaId);
    // Re-sincronizar subnets si cambió la IP de gestión/VPN
    if (dto.ipGestion || dto.vpnIp) this.syncSubnetsAsync(updated);
    // Re-inyectar solo cuando cambia algo que afecta la conectividad o las reglas
    if (dto.ipGestion || dto.vpnIp || rawPass || dto.tipoControl) {
      this.inyectarReglasMorososAsync(updated);
    }
    return updated;
  }

  async removeRouter(id: string, user: JwtPayload): Promise<void> {
    const router = await this.findOne(id, user.empresaId);

    // ── Verificaciones de bloqueo ────────────────────────────────
    const [
      [{ count: countContratos }],
      [{ count: countDispositivos }],
      [{ count: countOlts }],
      [{ count: countIpsActivas }],
    ] = await Promise.all([
      // Contratos activos/suspendidos
      this.ds.query<[{ count: string }]>(
        `SELECT COUNT(*) AS count FROM contratos
         WHERE router_id = $1
           AND estado IN ('activo','suspendido','pendiente_activacion')
           AND deleted_at IS NULL`,
        [id],
      ),
      // Equipos monitoreados (antenas, cámaras, etc.)
      this.ds.query<[{ count: string }]>(
        `SELECT COUNT(*) AS count FROM dispositivos_monitoreo
         WHERE router_acceso_id = $1 AND deleted_at IS NULL`,
        [id],
      ),
      // OLTs vinculadas a este router como cabecera
      this.ds.query<[{ count: string }]>(
        `SELECT COUNT(*) AS count FROM olt_dispositivos
         WHERE router_id = $1 AND deleted_at IS NULL`,
        [id],
      ),
      // IPs activas en segmentos del router (infraestructura / reservadas)
      this.ds.query<[{ count: string }]>(
        `SELECT COUNT(*) AS count FROM ips_asignadas ia
         JOIN segmentos_ipv4 s ON s.id = ia.segmento_id
         WHERE s.router_id = $1 AND s.deleted_at IS NULL AND ia.activa = true`,
        [id],
      ),
    ]);

    const bloqueadores: string[] = [];
    if (Number(countContratos)    > 0) bloqueadores.push(`${countContratos} abonado(s) con servicio activo`);
    if (Number(countDispositivos) > 0) bloqueadores.push(`${countDispositivos} equipo(s) monitoreado(s) (antenas, cámaras u otros)`);
    if (Number(countOlts)         > 0) bloqueadores.push(`${countOlts} OLT(s) registrada(s) con este router como cabecera`);
    if (Number(countIpsActivas)   > 0) bloqueadores.push(`${countIpsActivas} IP(s) activa(s) en segmentos de red del router`);

    if (bloqueadores.length > 0) {
      throw new BadRequestException(
        `No es posible eliminar este router porque tiene: ${bloqueadores.join(' y ')}. ` +
        `Reasigna o elimina estos elementos antes de continuar.`,
      );
    }

    // ── Eliminación ──────────────────────────────────────────────
    if (router.subnetsLocales?.length) {
      const gw = router.vpnIp || router.ipGestion;
      await this.subnetSvc.removeVpsRoutes(gw, router.subnetsLocales);
    }

    // Revocar VPN ANTES del softDelete para garantizar que si la revocación falla
    // el router siga visible en la UI y el operador pueda reintentar.
    const vpnClientes = await this.vpnSvc.listarPorRouterId(id, user.empresaId);
    for (const c of vpnClientes) {
      try {
        await this.vpnSvc.revocar(c.id, user.empresaId);
        this.logger.log(`VPN cliente revocado al eliminar router ${id}: ${c.id}`);
      } catch (err: any) {
        if (err?.status === 409 || err?.constructor?.name === 'ConflictException') {
          this.logger.warn(`VPN cliente ${c.id} ya estaba revocado — continuando`);
        } else {
          throw err;
        }
      }
    }

    await this.routerRepo.softDelete(id);
    await this.pool.invalidate(id);

    // Soft-delete segmentos y limpiar sus IPs asignadas
    try {
      await this.ds.query(
        `UPDATE segmentos_ipv4 SET activo = false, deleted_at = NOW()
         WHERE router_id = $1 AND deleted_at IS NULL`,
        [id],
      );
      await this.ds.query(
        `UPDATE ips_asignadas SET activa = false, liberada_en = NOW()
         WHERE segmento_id IN (
           SELECT id FROM segmentos_ipv4 WHERE router_id = $1
         ) AND activa = true`,
        [id],
      );
    } catch (err: any) {
      this.logger.warn(`Error limpiando segmentos/IPs del router ${id}: ${err.message}`);
    }

    await this.auditoria.log({
      empresaId:   user.empresaId,
      usuarioId:   user.sub,
      usuarioEmail: user.email,
      accion:      'DELETE',
      modulo:      'mikrotik',
      entidadId:   id,
      descripcion: `Router eliminado: ${router.nombre} (${router.ipGestion})`,
    });
  }

  // ════════════════════════════════════════════════════════════
  // REPARACIÓN AUTOMATIZADA — SIMULADO (listo para producción)
  // POST /mikrotik/routers/:id/reparar
  // ════════════════════════════════════════════════════════════
  // FIRMA DATAFAST: toda regla inyectada lleva el sufijo/comment
  //   con la palabra "datafast" para distinguirla de reglas manuales:
  //   address-list: "morosos-datafast"
  //   ppp/profile name: "Datafast-<plan>"
  //   queue/simple name: "Datafast-<usuario>"
  //   comment en cada regla: "Datafast - Contrato #<id>"
  // ════════════════════════════════════════════════════════════
  async repararRouter(
    routerId:  string,
    empresaId: string,
  ): Promise<{ mensaje: string; procesados: number; morosos: number; advertencias: string[] }> {
    const router = await this.findOne(routerId, empresaId);

    // Si la configuración VPN inicial falló (vpnCommonName quedó null), regenerar ahora
    if (router.metodoConexion === MetodoConexion.VPN_TUNNEL && !router.vpnCommonName) {
      this.logger.warn(`[VPN] Router ${routerId} sin vpnCommonName — regenerando VPN antes de reparar`);
      await this.vpnSvc.generarParaRouter(router);
      // Recargar solo los campos VPN actualizados para no contaminar la entidad tracked
      const fresh = await this.findOne(routerId, empresaId);
      router.vpnCommonName = fresh.vpnCommonName;
      router.vpnIp         = fresh.vpnIp;
    }

    const creds: RouterCredentials = {
      id:              router.id,
      ip:              router.vpnIp || router.ipGestion,
      port:            router.usarSsl ? (router.puertoApiSsl ?? 8729) : (router.puertoApi ?? 8728),
      user:            router.usuario ?? 'admin',
      passwordCifrado: router.passwordCifrado ?? '',
      useSsl:          router.usarSsl ?? false,
      timeoutSec:      20,
      version:         router.versionRos as any ?? 'v6',
    };

    const contratos = await this.ds.query<any[]>(`
      SELECT co.id, co.numero_contrato AS "numeroContrato",
             co.usuario_pppoe AS "usuarioPppoe", co.password_pppoe AS "passwordPppoe",
             co.ip_asignada AS "ipAsignada", co.mac_address AS "macAddress",
             co.estado,
             co.tipo_auth AS "tipoAuth",
             cl.nombre_completo AS "nombreCompleto",
             pl.ppp_profile AS "pppProfile"
      FROM contratos co
      JOIN clientes cl ON cl.id = co.cliente_id
      LEFT JOIN planes pl ON pl.id = co.plan_id
      WHERE co.router_id  = $1
        AND co.empresa_id = $2
        AND co.estado IN ('activo','suspendido')
        AND co.deleted_at IS NULL
    `, [routerId, empresaId]);

    const morososCount = contratos.filter(
      (c) => c.estado === 'suspendido',
    ).length;

    // Pre-flight: verificar conectividad antes de procesar ningún contrato
    try {
      await this.pool.execute(creds, async (api) => {
        await api.write('/system/identity/print');
      });
    } catch (err: any) {
      // Verificar si la sesión VPN está ocupada por un impostor
      // (router offline cuyo script fue pegado en otro equipo por error)
      let sesionKilled = false;
      try {
        sesionKilled = await this.vpnSvc.matarSesionImpostora(routerId, empresaId);
      } catch (vpnErr: any) {
        this.logger.warn(`[VPN] Error al verificar sesión impostora para ${routerId}: ${vpnErr.message}`);
      }
      if (sesionKilled) {
        throw new BadRequestException(
          `Sesión VPN del router "${router.nombre}" estaba ocupada por un dispositivo no autorizado. ` +
          `La sesión del impostor ha sido cerrada. ` +
          `El router legítimo debería reconectar en los próximos 15 segundos. ` +
          `Espere y vuelva a intentar "Reparar".`,
        );
      }
      throw new BadRequestException(
        `No se puede conectar al router "${router.nombre}" ` +
        `(${router.vpnIp || router.ipGestion}:${creds.port}). ` +
        `Configure el router antes de reparar: ` +
        `(1) verifique que el túnel VPN esté activo, ` +
        `(2) habilite la API de RouterOS en el puerto ${creds.port}, ` +
        `(3) configure WAN, LAN y el servidor PPPoE. ` +
        `Detalle: ${err.message}`,
      );
    }

    this.logger.log(
      `[REPARAR] ${router.nombre} — ${contratos.length} contratos, ` +
      `tipoControl=${router.tipoControl}, controlaAutenticacion=${router.controlaAutenticacion}`,
    );

    let ok = 0;
    const errores:      string[] = [];
    const advertencias: string[] = [];

    // Asegurar reglas globales de firewall (drop morosos / accept prorroga)
    await this.firewallSvc.configurarReglasControl(creds).catch((err) => {
      this.reglasOk.delete(router.id);
      advertencias.push(`Reglas de firewall: ${err?.message ?? 'error desconocido'}`);
      this.logger.warn(`[REPARAR] No se pudieron configurar reglas firewall en ${creds.ip}: ${err?.message}`);
    });

    for (const co of contratos) {
      // ── Auth efectiva que DEBE tener este contrato en el MikroTik ─────────
      const targetAuth: string = router.controlaAutenticacion
        ? router.tipoControl
        : (co.tipoAuth ?? 'ninguna');

      // ── Auth obsoleta que puede haber quedado en el MikroTik ──────────────
      // Solo limpiamos si conocemos con certeza qué fue provisionado antes Y
      // la familia de autenticación cambia (evitar borrar reglas que el nuevo
      // tipo también necesita, ej: amarre_ip_mac → amarre_ip_mac_dhcp ambos usan ARP).
      const staleAuth: string | null = (() => {
        if (router.controlaAutenticacion && co.tipoAuth && co.tipoAuth !== targetAuth) {
          // Transición false→true: cada abonado tenía auth individual, ahora el router controla.
          return co.tipoAuth;
        }
        if (!router.controlaAutenticacion && co.tipoAuth && co.tipoAuth !== router.tipoControl) {
          // Transición true→false: el router controlaba con tipoControl, ahora cada abonado
          // tiene su propio tipoAuth distinto al anterior tipoControl del router.
          return router.tipoControl;
        }
        return null;
      })();

      // Familias: 'pppoe' | 'mac' | 'none'
      const authFamily = (a: string) =>
        a === 'pppoe' ? 'pppoe'
        : (a === 'amarre_ip_mac' || a === 'amarre_ip_mac_dhcp') ? 'mac'
        : 'none';

      // Si stale y target son de la misma familia no limpiamos: la operación crear
      // ya escribe sobre las mismas entradas (idempotente) y limpiar borraría lo que
      // acabamos de crear. Solo limpiamos cuando la familia cambia (PPPoE ↔ MAC).
      const deberíaLimpiar =
        staleAuth !== null &&
        staleAuth !== 'ninguna' &&
        authFamily(staleAuth) !== authFamily(targetAuth);

      // ── Pre-flight: validar campos requeridos por el tipo destino ─────────
      const camposFaltantes: string[] = [];
      if (targetAuth === 'pppoe' && !co.usuarioPppoe)
        camposFaltantes.push('usuarioPppoe');
      if ((targetAuth === 'amarre_ip_mac' || targetAuth === 'amarre_ip_mac_dhcp') && !co.ipAsignada)
        camposFaltantes.push('ipAsignada');
      if ((targetAuth === 'amarre_ip_mac' || targetAuth === 'amarre_ip_mac_dhcp') && !co.macAddress)
        camposFaltantes.push('macAddress');

      if (camposFaltantes.length > 0) {
        // No se puede provisionar pero tampoco hay riesgo de dejar al abonado sin reglas.
        // Si el router ahora controla auth, limpiamos tipo_auth en BD para no reintentar indefinidamente.
        const aviso = `${co.numeroContrato}: sin ${camposFaltantes.join(', ')} para ${targetAuth} — omitido`;
        advertencias.push(aviso);
        this.logger.warn(`[REPARAR] ${aviso}`);
        if (router.controlaAutenticacion && co.tipoAuth) {
          await this.ds.query(`UPDATE contratos SET tipo_auth = NULL WHERE id = $1`, [co.id]);
        }
        ok++;
        continue;
      }

      try {
        // 1. Crear reglas nuevas (idempotente: si ya existen, las actualiza).
        if (targetAuth !== 'ninguna') {
          await this.crearReglasControl(creds, co, targetAuth);
        }

        // 2. Limpiar reglas obsoletas SOLO tras crear exitosamente las nuevas.
        //    Un fallo aquí es no-fatal: el abonado tiene sus nuevas reglas activas;
        //    la entrada huérfana en MikroTik no bloquea el acceso.
        if (deberíaLimpiar) {
          try {
            await this.limpiarReglasControl(creds, co, staleAuth!);
          } catch (cleanErr: any) {
            const aviso = `${co.numeroContrato}: reglas ${staleAuth} no eliminadas — ${cleanErr?.message ?? 'error'}`;
            advertencias.push(aviso);
            this.logger.warn(`[REPARAR] ${aviso}`);
          }
        }

        // 3. Limpiar tipo_auth en BD SOLO tras éxito en MikroTik.
        //    Si hubo fallo en MikroTik (catch externo), tipo_auth se conserva
        //    y el próximo reparar podrá reintentar este contrato.
        if (router.controlaAutenticacion && co.tipoAuth) {
          await this.ds.query(`UPDATE contratos SET tipo_auth = NULL WHERE id = $1`, [co.id]);
        }

        ok++;
        this.logger.log(
          `[REPARAR] ${co.numeroContrato}: ${staleAuth ?? '—'} → ${targetAuth} OK`,
        );
      } catch (err: any) {
        const esConexion = /timed out|econnrefused|econnreset|socket|no se pudo conectar/i
          .test(err?.message ?? '');
        if (esConexion) {
          throw new BadRequestException(
            `Conexión perdida con "${router.nombre}" al procesar ${co.numeroContrato} ` +
            `(${ok} de ${contratos.length} procesados antes del fallo). ` +
            `Verifique el túnel VPN y reintente. Detalle: ${err.message}`,
          );
        }
        errores.push(`${co.numeroContrato}: ${err?.message ?? 'error desconocido'}`);
        this.logger.warn(`[REPARAR] ${co.numeroContrato}: ERROR — ${err?.message}`);
        // tipo_auth NO se limpia: permite reintentar en el próximo reparar.
      }
    }

    const msg = errores.length === 0
      ? `Reparación completada para "${router.nombre}". ${ok}/${contratos.length} contratos procesados.`
      : `Reparación con ${errores.length} error(es). ${ok}/${contratos.length} OK. Errores: ${errores.slice(0, 3).join('; ')}`;

    return { mensaje: msg, procesados: ok, morosos: morososCount, advertencias };
  }

  // ── Planes únicos de un conjunto de contratos ─────────────
  private planesUnicos(contratos: any[]): any[] {
    const seen = new Set<string>();
    return contratos.filter((c) => {
      if (seen.has(c.plan_nombre)) return false;
      seen.add(c.plan_nombre);
      return true;
    });
  }

  // ── Construir credenciales para el pool ───────────────────
  private async getCredentials(routerId: string, empresaId: string, timeoutOverrideSec?: number): Promise<RouterCredentials> {
    const router = await this.findOne(routerId, empresaId);
    const port   = router.usarSsl ? router.puertoApiSsl : router.puertoApi;
    // Si el router tiene VPN configurada, conectar por esa IP
    const ip = router.vpnIp || router.ipGestion;
    return {
      id:              router.id,
      ip,
      port,
      user:            router.usuario,
      passwordCifrado: router.passwordCifrado,
      useSsl:          router.usarSsl,
      timeoutSec:      timeoutOverrideSec ?? router.timeoutConexion ?? 10,
      version:         router.versionRos === VersionRouterOS.V7 ? 'v7' : 'v6',
    };
  }

  // ────────────────────────────────────────────────────────────
  // AMARRE IP + MAC  (ARP estático + opcionalmente DHCP lease)
  // ────────────────────────────────────────────────────────────
  async aplicarAmareIpMac(
    routerId: string,
    dto:      AmareIpMacDto,
    user:     JwtPayload,
  ): Promise<{ arp: boolean; dhcp: boolean }> {
    const router = await this.findOne(routerId, user.empresaId);
    const creds  = await this.getCredentials(routerId, user.empresaId);
    const comment = `DATAFAST:${dto.clienteId ? `ClienteID:${dto.clienteId}` : dto.hostname || dto.ip}`;

    let dhcpAdded = false;

    await this.pool.execute(creds, async (api) => {
      // 1. Agregar entrada ARP estática en IP > ARP
      const arpExistente = await api.write('/ip/arp/print', [
        `?address=${dto.ip}`,
        `?mac-address=${dto.mac}`,
      ]);
      if (!arpExistente.length) {
        await api.write('/ip/arp/add', [
          `=address=${dto.ip}`,
          `=mac-address=${dto.mac}`,
          `=comment=${comment}`,
        ]);
      }

      // 2. Si el control incluye DHCP lease, también agregar en DHCP Server > Leases
      if (
        router.tipoControl === TipoControl.AMARRE_IP_MAC_DHCP ||
        dto.dhcpServer
      ) {
        const server = dto.dhcpServer || 'dhcp1';
        const leaseExistente = await api.write('/ip/dhcp-server/lease/print', [
          `?address=${dto.ip}`,
        ]);
        if (!leaseExistente.length) {
          await api.write('/ip/dhcp-server/lease/add', [
            `=address=${dto.ip}`,
            `=mac-address=${dto.mac}`,
            `=server=${server}`,
            `=comment=${comment}`,
          ]);
          dhcpAdded = true;
        } else {
          dhcpAdded = true; // ya existía
        }
      }
    });

    await this.auditoria.log({
      empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      accion:       'AMARRE_IP_MAC',
      modulo:       'mikrotik',
      entidadId:    dto.clienteId || routerId,
      descripcion:  `Amarre IP ${dto.ip} ↔ MAC ${dto.mac} en ${creds.ip}${dhcpAdded ? ' + DHCP lease' : ''}`,
    });

    return { arp: true, dhcp: dhcpAdded };
  }

  // ────────────────────────────────────────────────────────────
  // ACTUALIZAR QUEUE DE UN CLIENTE
  // ────────────────────────────────────────────────────────────
  async actualizarQueue(
    routerId:   string,
    dto:        ActualizarQueueDto,
    empresaId:  string,
  ): Promise<void> {
    this.assertNotDegraded();
    const router = await this.findOne(routerId, empresaId);
    if (!router.passwordCifrado) {
      throw new BadRequestException(`Router ${routerId} no tiene contraseña configurada`);
    }
    const creds: RouterCredentials = {
      id:              router.id,
      ip:              router.vpnIp || router.ipGestion,
      port:            router.usarSsl ? (router.puertoApiSsl ?? 8729) : (router.puertoApi ?? 8728),
      user:            router.usuario ?? 'admin',
      passwordCifrado: router.passwordCifrado,
      useSsl:          router.usarSsl ?? false,
      timeoutSec:      10,
      version:         (router.versionRos as 'v6' | 'v7') ?? 'v6',
    };
    await this.queueSvc.actualizarVelocidadQueue(creds, dto.nombreQueue, dto.downloadMbps, dto.uploadMbps);
  }

  // ────────────────────────────────────────────────────────────
  // PROVISIONAR CLIENTE EN MIKROTIK
  // Orquesta: PPPoE + Queue + Firewall rules
  // ────────────────────────────────────────────────────────────
  async provisionarCliente(
    routerId: string,
    dto:      ProvisionarClienteDto,
    user:     JwtPayload,
  ): Promise<{ ppppoeId: string; queueId: string }> {
    this.assertNotDegraded();
    const creds = await this.getCredentials(routerId, user.empresaId);

    this.logger.log(
      `[SAGA] Iniciando provisioning cliente ${dto.clienteId} en ${creds.ip}: ` +
      `PPPoE=${dto.usuarioPppoe} | IP=${dto.ipAsignada} | ${dto.uploadMbps}/${dto.downloadMbps} Mbps`,
    );

    // ── PASO A: Crear usuario PPPoE ────────────────────────
    let ppppoeId = '';
    try {
      ppppoeId = await this.pppoeSvc.crear(creds, {
        name:          dto.usuarioPppoe,
        password:      dto.passwordPppoe,
        profile:       dto.perfilPppoe || 'default',
        service:       'pppoe',
        remoteAddress: dto.ipAsignada,
        comment:       `DATAFAST:ClienteID:${dto.clienteId}`,
        disabled:      false,
      });
    } catch (errA: any) {
      // Paso A falló antes de crear nada en hardware: no hay que compensar
      this.logger.error(`[SAGA] Paso A (PPPoE) falló para ${dto.clienteId}: ${errA.message}`);
      throw errA;
    }

    // ── PASO B: Crear Queue de velocidad ───────────────────
    const hasSimpleQueue = dto.tipoQueue === 'simple_queue' || !dto.tipoQueue;
    let queueId = '';

    try {
      if (hasSimpleQueue) {
        queueId = await this.queueSvc.crearSimpleQueue(creds, {
          name:           dto.usuarioPppoe,
          target:         `${dto.ipAsignada}/32`,
          maxLimitDown:   dto.downloadMbps,
          maxLimitUp:     dto.uploadMbps,
          burstLimitDown: dto.burstDownMbps,
          burstLimitUp:   dto.burstUpMbps,
          burstTimeDown:  dto.burstTiempoSegundos,
          burstTimeUp:    dto.burstTiempoSegundos,
          comment:        `DATAFAST:ClienteID:${dto.clienteId}`,
        });
      } else if (dto.tipoQueue === 'queue_tree' || dto.tipoQueue === 'pcq') {
        const tienePcq = await this.queueSvc.tienePcqConfigurado(creds);
        if (!tienePcq) {
          await this.queueSvc.configurarPcqCompleto(creds, {
            namePrefix:   'datafast',
            downloadMbps: dto.downloadMbps * 10,
            uploadMbps:   dto.uploadMbps * 10,
          });
        }
      }
    } catch (errB: any) {
      // ── COMPENSACIÓN: Paso B falló → revertir Paso A ────
      this.logger.error(
        `[SAGA] Paso B (Queue) falló para ${dto.clienteId}: ${errB.message}. ` +
        `Compensando: eliminando PPPoE ${dto.usuarioPppoe}...`,
      );
      try {
        await this.pppoeSvc.eliminar(creds, dto.usuarioPppoe);
        this.logger.log(`[SAGA] Compensación OK: PPPoE ${dto.usuarioPppoe} eliminado en ${creds.ip}`);
      } catch (errComp: any) {
        // Compensación también falló: PPPoE queda huérfano en el router.
        // reparar() lo limpiará cuando el operador lo ejecute.
        this.logger.error(
          `[SAGA] Compensación FALLÓ para ${dto.usuarioPppoe} en ${creds.ip}: ${errComp.message}. ` +
          `PPPoE huérfano — usar "Reparar" para limpiar.`,
        );
      }
      throw new Error(
        `Error al crear la cola de velocidad para ${dto.usuarioPppoe}: ${errB.message}. ` +
        `El usuario PPPoE fue eliminado del router (compensación aplicada).`,
      );
    }

    // ── PASO C: Reglas de firewall (idempotente, no requiere compensación) ──
    if (user.empresaId) {
      await this.firewallSvc.configurarReglasControl(creds).catch((err) =>
        this.logger.warn(
          `[SAGA] Paso C (Firewall) no crítico — se aplicará en el próximo poll: ${err.message}`,
        ),
      );
    }

    await this.auditoria.log({
      empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      accion: 'PROVISION', modulo: 'mikrotik', entidadId: dto.clienteId,
      descripcion: `[SAGA OK] PPPoE ${dto.usuarioPppoe} + Queue provisionados en ${creds.ip} | IP: ${dto.ipAsignada}`,
    });

    this.logger.log(`[SAGA] Provisioning completado: ${dto.clienteId} en ${creds.ip}`);
    return { ppppoeId, queueId };
  }

  // ────────────────────────────────────────────────────────────
  // SUSPENDER CLIENTE (por mora)
  // 1. Agrega IP a Address List "morosos" → firewall la bloquea
  // 2. Desconecta la sesión PPPoE activa
  // ────────────────────────────────────────────────────────────
  async suspenderCliente(
    routerId: string,
    dto:      SuspenderClienteDto,
    user:     JwtPayload,
  ): Promise<void> {
    this.assertNotDegraded();
    const creds = await this.getCredentials(routerId, user.empresaId);

    // 1. Agregar a Address List morosos
    await this.firewallSvc.suspenderCliente(
      creds, dto.ipAsignada, dto.clienteId,
      `Suspensión manual: ${dto.nombreCliente ?? dto.clienteId} | ${dto.motivo ?? 'mora'} | ${new Date().toLocaleDateString('es-PE')}`,
    );

    // 2. Desconectar sesión PPPoE activa si existe
    if (dto.usuarioPppoe) {
      await this.pppoeSvc.desconectarSesion(creds, dto.usuarioPppoe).catch((err) =>
        this.logger.warn(`No se pudo desconectar sesión ${dto.usuarioPppoe}: ${err.message}`),
      );
    }

    // 3. Emitir evento para notificación al cliente
    this.events.emit(EVENT_CLIENTE_SUSPENDIDO, {
      clienteId: dto.clienteId,
      empresaId: user.empresaId,
      ip:        dto.ipAsignada,
      routerId,
    });

    await this.auditoria.log({
      empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      accion: 'SUSPEND', modulo: 'mikrotik', entidadId: dto.clienteId,
      descripcion: `IP ${dto.ipAsignada} suspendida en ${creds.ip} | Motivo: ${dto.motivo || 'mora'}`,
    });

    this.logger.log(`Cliente suspendido: ${dto.clienteId} | IP: ${dto.ipAsignada} | router: ${creds.ip}`);
  }

  // ────────────────────────────────────────────────────────────
  // REACTIVAR CLIENTE
  // 1. Quita IP de la Address List "morosos"
  // 2. El cliente puede reconectarse con sus credenciales PPPoE
  // ────────────────────────────────────────────────────────────
  async reactivarCliente(
    routerId: string,
    dto:      ReactivarClienteDto,
    user:     JwtPayload,
  ): Promise<void> {
    this.assertNotDegraded();
    const creds = await this.getCredentials(routerId, user.empresaId);

    // Quitar de Address Lists de control
    await this.firewallSvc.reactivarCliente(creds, dto.ipAsignada);

    // Emitir evento para notificación
    this.events.emit(EVENT_CLIENTE_REACTIVADO, {
      clienteId: dto.clienteId,
      empresaId: user.empresaId,
      ip:        dto.ipAsignada,
      routerId,
    });

    await this.auditoria.log({
      empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      accion: 'REACTIVATE', modulo: 'mikrotik', entidadId: dto.clienteId,
      descripcion: `IP ${dto.ipAsignada} reactivada en ${creds.ip}`,
    });

    this.logger.log(`Cliente reactivado: ${dto.clienteId} | IP: ${dto.ipAsignada}`);
  }

  // ────────────────────────────────────────────────────────────
  // INFORMACIÓN EN TIEMPO REAL
  // ────────────────────────────────────────────────────────────

  async getEstadoRouter(routerId: string, empresaId: string): Promise<{
    router:      Router;
    recursos:    any;
    interfaces:  any[];
    sesionesActivas: number;
    version:     string;
  }> {
    const router = await this.findOne(routerId, empresaId);
    const creds  = await this.getCredentials(routerId, empresaId);

    const [recursos, interfaces, sesionesActivas] = await Promise.all([
      this.ifaceSvc.getRecursos(creds, 'monitoreo'),
      this.ifaceSvc.listarInterfaces(creds),
      this.pppoeSvc.contarSesionesActivas(creds, 'monitoreo').catch(() => 0),
    ]);

    // Actualizar estado en BD
    await this.routerRepo.update(routerId, {
      estado:           EstadoEquipo.ONLINE,
      ultimoPing:       new Date(),
      cpuUsoPct:        recursos.cpuLoad,
      memoriaUsoPct:    recursos.freeMemory
        ? Math.round((1 - recursos.freeMemory / recursos.totalMemory) * 100)
        : null,
      uptimeSegundos:   recursos.uptimeSeconds,
      versionFirmware:  recursos.version,
      identityRouteros: await this.ifaceSvc.getIdentity(creds).catch(() => ''),
      versionRos:       recursos.version?.startsWith('7')
        ? VersionRouterOS.V7
        : VersionRouterOS.V6,
    });

    return {
      router:          await this.findOne(routerId, empresaId),
      recursos,
      interfaces,
      sesionesActivas,
      version:         recursos.version,
    };
  }

  async getSesionesPppoe(routerId: string, empresaId: string): Promise<any[]> {
    const creds = await this.getCredentials(routerId, empresaId, 25);
    return this.pppoeSvc.listarSesionesActivas(creds);
  }

  async getMorosos(routerId: string, empresaId: string): Promise<any[]> {
    const creds = await this.getCredentials(routerId, empresaId);
    return this.firewallSvc.listarMorosos(creds);
  }

  async getQueues(routerId: string, empresaId: string): Promise<any[]> {
    const creds = await this.getCredentials(routerId, empresaId);
    return this.queueSvc.listarSimpleQueues(creds);
  }

  async getInterfaces(routerId: string, empresaId: string): Promise<any[]> {
    const creds = await this.getCredentials(routerId, empresaId);
    return this.ifaceSvc.listarInterfaces(creds);
  }

  async getDhcpLeases(routerId: string, empresaId: string): Promise<any[]> {
    const creds = await this.getCredentials(routerId, empresaId);
    return this.firewallSvc.listarDhcpLeases(creds);
  }

  async getTrafico(routerId: string, empresaId: string, iface?: string): Promise<any[]> {
    const creds     = await this.getCredentials(routerId, empresaId);
    const interfaces = await this.ifaceSvc.listarInterfaces(creds);
    const target    = iface || interfaces[0]?.name || 'ether1';
    return this.ifaceSvc.monitorearInterface(creds, target, 5);
  }

  async pingDesdeRouter(routerId: string, empresaId: string, destino: string): Promise<any> {
    const creds = await this.getCredentials(routerId, empresaId);
    return this.ifaceSvc.ping(creds, destino);
  }

  // ── Configurar reglas de firewall en un router nuevo ─────
  async configurarFirewallControl(routerId: string, empresaId: string): Promise<void> {
    const creds = await this.getCredentials(routerId, empresaId);
    await this.firewallSvc.configurarReglasControl(creds);
  }

  // ── Testar conexión al router ─────────────────────────────
  async testConexion(routerId: string, empresaId: string): Promise<{
    exitoso: boolean; mensaje: string; latenciaMs?: number;
  }> {
    const router = await this.findOne(routerId, empresaId);
    const creds  = await this.getCredentials(routerId, empresaId);
    const inicio = Date.now();

    try {
      await this.pool.invalidate(routerId); // forzar nueva conexión
      const identity = await this.ifaceSvc.getIdentity(creds);
      const latencia = Date.now() - inicio;

      await this.routerRepo.update(routerId, {
        estado:    EstadoEquipo.ONLINE,
        ultimoPing: new Date(),
        latenciaMs: latencia,
        identityRouteros: identity,
      });

      // Resetear contador de fallos del cron: la prueba manual confirmó conectividad,
      // el router debe recibir la gracia de 2 fallos consecutivos de nuevo.
      this._pollFailCount.delete(routerId);

      this.inyectarReglasMorososAsync(router);

      return { exitoso: true, mensaje: `Conectado a "${identity}" en ${latencia}ms`, latenciaMs: latencia };

    } catch (error) {
      await this.routerRepo.update(routerId, { estado: EstadoEquipo.OFFLINE });
      return { exitoso: false, mensaje: `No se pudo conectar: ${error.message}` };
    }
  }

  // ────────────────────────────────────────────────────────────
  // TEST DE CONEXIÓN DIRECTA (antes de guardar el router)
  // ────────────────────────────────────────────────────────────

  async testConexionDirecta(dto: TestConexionDirectaDto, empresaId?: string): Promise<{
    exitoso: boolean;
    mensaje: string;
    latenciaMs?: number;
    versionDetectada?: string;
    identityDetectada?: string;
    rosVersion?: string;
  }> {
    // ── Bloquear SSRF: loopback y link-local no son routers válidos ─────────
    // Permite IPs privadas (192.168.x, 10.x, 172.16-31.x) porque son routers LAN legítimos.
    // Bloquea solo loopback VPS (127.x) y cloud metadata (169.254.x) que expondrían servicios internos.
    const ipLower = dto.ip.toLowerCase().trim();
    if (
      ipLower === 'localhost' ||
      ipLower.startsWith('127.') ||
      ipLower === '0.0.0.0' ||
      ipLower.startsWith('169.254.') ||
      ipLower === '::1'
    ) {
      throw new BadRequestException(`La IP "${dto.ip}" no es un destino válido para un router`);
    }

    // ── Resolver contraseña: sentinel '***stored***' → leer de BD ─
    let resolvedPassword = dto.password ?? '';
    if ((!resolvedPassword || resolvedPassword === '***stored***') && dto.routerId) {
      if (!empresaId) throw new BadRequestException('Empresa no identificada');
      const stored = await this.routerRepo.findOne({ where: { id: dto.routerId, empresaId } });
      if (stored) resolvedPassword = stored.passwordCifrado;
    }

    const inicio  = Date.now();
    const metodo  = dto.metodoConexion || MetodoConexion.API;

    // SSH / SNMP: solo verificar accesibilidad TCP
    if (metodo === MetodoConexion.SSH || metodo === MetodoConexion.SNMP) {
      return this._tcpCheck(dto.ip, dto.puerto, dto.timeoutConexion ?? 10, inicio);
    }

    // API / API_SSL / VPN_TUNNEL: autenticar con RouterOS API
    const useSsl   = dto.usarSsl ?? (metodo === MetodoConexion.API_SSL);
    const tempCreds: RouterCredentials = {
      id:              `temp-${Date.now()}`,
      ip:              dto.ip,
      port:            dto.puerto,
      user:            dto.usuario,
      passwordCifrado: resolvedPassword,
      useSsl,
      timeoutSec:      dto.timeoutConexion ?? 10,
      version:         dto.versionRos === VersionRouterOS.V7 ? 'v7' : 'v6',
    };

    let api: any = null;
    try {
      api = await this.pool.connectDirect(tempCreds);

      const [[ident], [res]] = await Promise.all([
        api.write('/system/identity/print'),
        api.write('/system/resource/print'),
      ]);

      const latencia = Date.now() - inicio;
      const version  = res?.version || '';
      const rosVer   = version.startsWith('7') ? 'v7' : 'v6';

      return {
        exitoso:           true,
        mensaje:           `Conectado: "${ident?.name || 'router'}" | RouterOS ${version} | ${latencia}ms`,
        latenciaMs:        latencia,
        versionDetectada:  version,
        identityDetectada: ident?.name || '',
        rosVersion:        rosVer,
      };
    } catch (err: any) {
      return { exitoso: false, mensaje: this._connectionErrorMsg(err.message || '') };
    } finally {
      if (api) try { api.close?.(); } catch { /* ignore */ }
    }
  }

  private _connectionErrorMsg(msg: string): string {
    const m = msg.toLowerCase();
    if (m.includes('econnrefused'))                     return 'Puerto cerrado — verificar IP y puerto';
    if (m.includes('timeout') || m.includes('timed out') || m.includes('socktmout')) return 'Timeout — verificar IP, puerto y firewall del router';
    if (m.includes('login') || m.includes('wrong'))     return 'Autenticación fallida — verificar usuario y contraseña';
    if (m.includes('enotfound') || m.includes('ehostunreach')) return 'Host no encontrado — verificar IP o dominio';
    if (m.includes('pool exhausto'))                    return 'Pool saturado — intenta en unos segundos';
    return msg;
  }

  private _tcpCheck(
    host: string, port: number, timeoutSec: number, inicio: number,
  ): Promise<{ exitoso: boolean; mensaje: string; latenciaMs?: number }> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timer  = setTimeout(() => {
        socket.destroy();
        resolve({ exitoso: false, mensaje: `Timeout al conectar a ${host}:${port}` });
      }, timeoutSec * 1000);

      socket.connect(port, host, () => {
        clearTimeout(timer);
        socket.destroy();
        const ms = Date.now() - inicio;
        resolve({ exitoso: true, mensaje: `Puerto ${port} accesible en ${ms}ms`, latenciaMs: ms });
      });

      socket.on('error', (err: Error) => {
        clearTimeout(timer);
        socket.destroy();
        resolve({ exitoso: false, mensaje: this._connectionErrorMsg(err.message) });
      });
    });
  }

  // ── Sincronizar subnets LAN y rutas VPS ───────────────────

  async syncSubnets(routerId: string, empresaId: string): Promise<string[]> {
    const router = await this.findOne(routerId, empresaId);
    const subnets = await this.subnetSvc.fetchSubnets(router);
    await this.routerRepo.update(routerId, { subnetsLocales: subnets });
    const gw = router.vpnIp || router.ipGestion;
    await this.subnetSvc.applyVpsRoutes(gw, subnets);

    // Actualizar CCD + forzar reconexión: detecta CN real y sincroniza BD si hay mismatch
    if (router.metodoConexion === MetodoConexion.VPN_TUNNEL) {
      const routerFresh = await this.findOne(routerId, router.empresaId);
      routerFresh.subnetsLocales = subnets;
      await this.vpnSvc.sincronizarCcdYReconectar(routerFresh).catch(e =>
        this.logger.warn(`[VPN-CCD] sync error ${router.nombre}: ${e.message}`)
      );
    }

    this.logger.log(`Subnets sincronizados: ${router.nombre} → [${subnets.join(', ')}]`);
    return subnets;
  }

  private syncSubnetsAsync(router: Router): void {
    this.subnetSvc.fetchSubnets(router)
      .then(async (subnets) => {
        await this.routerRepo.update(router.id, { subnetsLocales: subnets });
        const gw = router.vpnIp || router.ipGestion;
        await this.subnetSvc.applyVpsRoutes(gw, subnets);
        // CCD + reconexión también en el auto-sync (creación/actualización de router)
        if (router.metodoConexion === MetodoConexion.VPN_TUNNEL) {
          const routerFresh = { ...router, subnetsLocales: subnets } as Router;
          this.vpnSvc.sincronizarCcdYReconectar(routerFresh).catch(
            e => this.logger.warn(`[VPN-CCD] auto-sync CCD ${router.nombre}: ${e.message}`)
          );
        }
        this.logger.log(`Subnets auto-sync: ${router.nombre} → [${subnets.join(', ')}]`);
      })
      .catch(e => this.logger.warn(`Error auto-sync subnets ${router.nombre}: ${e.message}`));
  }

  // ── Inyectar regla morosos de forma asíncrona ─────────────
  private inyectarReglasMorososAsync(router: Router): void {
    const ip   = router.vpnIp || router.ipGestion;
    const port = router.usarSsl ? router.puertoApiSsl : router.puertoApi;
    const creds: RouterCredentials = {
      id:              router.id,
      ip,
      port,
      user:            router.usuario,
      passwordCifrado: router.passwordCifrado,
      useSsl:          router.usarSsl,
      timeoutSec:      router.timeoutConexion || 15,
      version:         router.versionRos === VersionRouterOS.V7 ? 'v7' : 'v6',
    };

    this.firewallSvc.configurarReglasControl(creds)
      .then(() => { this.reglasOk.add(router.id); this.logger.log(`Reglas de control aplicadas: ${ip}`); })
      .catch((err) => this.logger.warn(`No se pudieron aplicar reglas en ${ip}: ${err.message}`));
  }

  // ────────────────────────────────────────────────────────────
  // POLLING DE MÉTRICAS (CPU/RAM/sesiones) — cada 5 minutos
  // Solo se ejecuta en la instancia 0 del clúster PM2
  // ────────────────────────────────────────────────────────────
  @Cron('*/5 * * * *', { timeZone: 'America/Lima' })
  async pollRouterMetrics(): Promise<void> {
    if (process.env.NODE_APP_INSTANCE !== undefined && process.env.NODE_APP_INSTANCE !== '0') return;
    if (this._pollRunning) {
      this.logger.warn('[POLL] Vuelta anterior aún en curso — omitiendo ciclo');
      return;
    }
    this._pollRunning = true;

    let routers: Router[];
    try {
      routers = await this.routerRepo.find({
        where: { activo: true, deletedAt: null as any },
      });
    } catch { return; }

    const pollOne = async (router: Router): Promise<void> => {
      // El CB del proceso worker es independiente del API. testConexion() resetea el CB
      // del API pero no el del worker, dejando el CB del worker abierto indefinidamente.
      // El cron tiene su propia lógica de tolerancia (_pollFailCount) — el CB es redundante.
      this.pool.resetCb(router.id);

      try {
        const creds: RouterCredentials = {
          id:              router.id,
          ip:              router.vpnIp || router.ipGestion,
          port:            router.usarSsl ? router.puertoApiSsl : router.puertoApi,
          user:            router.usuario,
          passwordCifrado: router.passwordCifrado,
          useSsl:          router.usarSsl,
          timeoutSec:      Math.min(router.timeoutConexion || 10, 8),
          version:         router.versionRos === VersionRouterOS.V7 ? 'v7' : 'v6',
        };

        const esPppoe = router.tipoControl === TipoControl.PPPOE;
        const [recursos, sesionesCount] = await Promise.all([
          this.ifaceSvc.getRecursos(creds, 'monitoreo'),
          esPppoe
            ? this.pppoeSvc.contarSesionesActivas(creds, 'monitoreo').catch(() => 0)
            : Promise.resolve(0),
        ]);

        const memoriaUsoPct = recursos.freeMemory && recursos.totalMemory
          ? Math.round((1 - recursos.freeMemory / recursos.totalMemory) * 100)
          : null;

        const uptimeSec = recursos.uptimeSeconds ?? 0;
        const d = Math.floor(uptimeSec / 86400);
        const h = Math.floor((uptimeSec % 86400) / 3600);
        const m = Math.floor((uptimeSec % 3600) / 60);
        const uptimeStr = d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;

        await this.routerRepo.update(router.id, {
          estado:             EstadoEquipo.ONLINE,
          ultimoPing:         new Date(),
          cpuUsoPct:          recursos.cpuLoad ?? null,
          memoriaUsoPct,
          uptimeSegundos:     uptimeSec || null,
          uptimeStr:          uptimeSec ? uptimeStr : null,
          versionFirmware:    recursos.version ?? router.versionFirmware,
          totalSesionesPppoe: sesionesCount,
        });

        // Reset contador de fallos consecutivos al recuperar conectividad
        const prevFailsOnRecovery = this._pollFailCount.get(router.id) ?? 0;
        this._pollFailCount.delete(router.id);

        // Emitir alerta de recuperación solo si el router estaba OFFLINE confirmado (≥2 fallos)
        if (prevFailsOnRecovery >= 2) {
          this.events.emit(NOTIFICATION_EVENTS.ROUTER_CONECTADO, {
            routerNombre: router.nombre,
            empresaId:    router.empresaId,
          });
        }

        if (!this.reglasOk.has(router.id)) {
          this.firewallSvc.configurarReglasControl(creds)
            .then(() => { this.reglasOk.add(router.id); this.logger.log(`Reglas de control (poll) aplicadas: ${creds.ip}`); })
            .catch((err) => this.logger.warn(`No se pudieron aplicar reglas en ${creds.ip}: ${err.message}`));
        }
      } catch {
        const prevFails = (this._pollFailCount.get(router.id) ?? 0) + 1;
        this._pollFailCount.set(router.id, prevFails);

        if (prevFails === 1) {
          // Primer fallo: puede ser un timeout transitorio — no declarar OFFLINE aún
          await this.routerRepo.update(router.id, { estado: EstadoEquipo.REVERIFICANDO });
          this.logger.warn(`[POLL] ${router.nombre} (${router.vpnIp || router.ipGestion}): fallo transitorio #${prevFails} → REVERIFICANDO`);
        } else {
          // Segundo fallo o más: OFFLINE confirmado
          await this.routerRepo.update(router.id, {
            estado:             EstadoEquipo.OFFLINE,
            cpuUsoPct:          null,
            memoriaUsoPct:      null,
            totalSesionesPppoe: 0,
          });
          this.reglasOk.delete(router.id);
          this.logger.warn(`[POLL] ${router.nombre} (${router.vpnIp || router.ipGestion}): fallo #${prevFails} → OFFLINE`);

          // Emitir alerta solo en la transición (fallo #2), no en cada ciclo siguiente
          if (prevFails === 2) {
            this.events.emit(NOTIFICATION_EVENTS.ROUTER_CAIDO, {
              routerNombre: router.nombre,
              empresaId:    router.empresaId,
            });
          }
        }
      }
    };

    try {
      const CHUNK = 4;
      for (let i = 0; i < routers.length; i += CHUNK) {
        await Promise.allSettled(routers.slice(i, i + CHUNK).map(pollOne));
      }
    } finally {
      this._pollRunning = false;
    }
  }

  // ── Detectar versión RouterOS (retorna Promise para poder awaitar con timeout) ──
  private detectarVersionAsync(router: Router): Promise<void> {
    const creds: RouterCredentials = {
      id:              router.id,
      ip:              router.vpnIp || router.ipGestion,
      port:            router.usarSsl ? router.puertoApiSsl : router.puertoApi,
      user:            router.usuario,
      passwordCifrado: router.passwordCifrado,
      useSsl:          router.usarSsl,
      timeoutSec:      router.timeoutConexion || 10,
      version:         router.versionRos === VersionRouterOS.V7 ? 'v7' : 'v6',
    };

    return this.ifaceSvc.getRecursos(creds)
      .then((recursos) => {
        const version    = recursos.version || '';
        const rosVersion = version.startsWith('7') ? VersionRouterOS.V7 : VersionRouterOS.V6;
        return this.routerRepo.update(router.id, {
          versionRos: rosVersion,
          estado:     EstadoEquipo.ONLINE,
          ultimoPing: new Date(),
        });
      })
      .then(() => {})
      .catch((err) => {
        // Si no responde al registrar, queda en DESCONOCIDO; el cron actualizará.
        this.logger.warn(`No se pudo detectar versión en ${router.vpnIp || router.ipGestion} al registrar: ${err.message}`);
      });
  }

  // ────────────────────────────────────────────────────────────
  // MIGRACIÓN MASIVA DE CLIENTES AL CAMBIAR tipo_control
  // ────────────────────────────────────────────────────────────

  async migrarClientesRouter(
    routerId:       string,
    oldTipoControl: string,
    empresaId:      string,
  ): Promise<{ total: number; ok: number; errores: Array<{ contratoId: string; numero: string; error: string }> }> {
    const router = await this.findOne(routerId, empresaId);
    const newTipoControl = router.tipoControl;

    const creds: RouterCredentials = {
      id:              router.id,
      ip:              router.vpnIp || router.ipGestion,
      port:            router.usarSsl ? (router.puertoApiSsl ?? 8729) : (router.puertoApi ?? 8728),
      user:            router.usuario ?? 'admin',
      passwordCifrado: router.passwordCifrado ?? '',
      useSsl:          router.usarSsl ?? false,
      timeoutSec:      20,
      version:         router.versionRos as any ?? 'v6',
    };

    // Pre-flight: verificar conectividad antes de comenzar la migración.
    // Sin esto, un fallo a mitad deja algunos contratos migrados y otros no.
    try {
      await this.pool.execute(creds, async (api) => {
        await api.write('/system/identity/print');
      });
    } catch (err: any) {
      throw new BadRequestException(
        `No se puede conectar al router "${router.nombre}" ` +
        `(${creds.ip}:${creds.port}) — verifica el túnel VPN antes de migrar. ` +
        `Detalle: ${err.message}`,
      );
    }

    const contratos = await this.ds.query<any[]>(`
      SELECT co.id, co.numero_contrato AS "numeroContrato",
             co.usuario_pppoe AS "usuarioPppoe", co.password_pppoe AS "passwordPppoe",
             co.ip_asignada AS "ipAsignada", co.mac_address AS "macAddress",
             cl.nombre_completo AS "nombreCompleto",
             pl.ppp_profile AS "pppProfile"
      FROM contratos co
      JOIN clientes cl ON cl.id = co.cliente_id
      LEFT JOIN planes pl ON pl.id = co.plan_id
      WHERE co.router_id = $1
        AND co.empresa_id = $2
        AND co.estado IN ('activo','suspendido')
        AND co.deleted_at IS NULL
    `, [routerId, empresaId]);

    const errores: Array<{ contratoId: string; numero: string; error: string }> = [];
    let ok = 0;

    for (const co of contratos) {
      try {
        // 1. Crear reglas del nuevo tipo (si falla, las viejas permanecen intactas)
        await this.crearReglasControl(creds, co, newTipoControl);
        // 2. Limpiar reglas del tipo anterior (solo si la creación fue exitosa)
        await this.limpiarReglasControl(creds, co, oldTipoControl);
        ok++;
        this.logger.log(`migrarClientes → contrato ${co.numeroContrato}: ${oldTipoControl} → ${newTipoControl} OK`);
      } catch (err: any) {
        errores.push({ contratoId: co.id, numero: co.numeroContrato, error: err?.message ?? 'Error desconocido' });
        this.logger.warn(`migrarClientes → contrato ${co.numeroContrato}: ERROR — ${err?.message}`);
      }
    }

    return { total: contratos.length, ok, errores };
  }

  private async limpiarReglasControl(creds: RouterCredentials, co: any, tipoControl: string): Promise<void> {
    if (tipoControl === 'pppoe') {
      if (co.usuarioPppoe) await this.pppoeSvc.eliminar(creds, co.usuarioPppoe);

    } else if (tipoControl === 'amarre_ip_mac' || tipoControl === 'amarre_ip_mac_dhcp') {
      if (co.ipAsignada) {
        await this.pool.execute(creds, async (api) => {
          const arps = await api.write('/ip/arp/print', [`?address=${co.ipAsignada}`]);
          for (const a of arps) await api.write('/ip/arp/remove', [`=.id=${a['.id']}`]);
        });
      }
      if (tipoControl === 'amarre_ip_mac_dhcp' && co.macAddress) {
        await this.pool.execute(creds, async (api) => {
          const macFmt = co.macAddress.toUpperCase().replace(/[^A-F0-9]/g, '').match(/.{2}/g)?.join(':') ?? co.macAddress.toUpperCase();
          // Filtrar en RouterOS API directamente, evitando cargar todos los leases en Node
          const matches = await api.write('/ip/dhcp-server/lease/print', [`?mac-address=${macFmt}`]);
          for (const m of matches) {
            await api.write('/ip/dhcp-server/lease/remove', [`=.id=${m['.id']}`]);
          }
        });
      }
    }
  }

  async crearReglasControl(creds: RouterCredentials, co: any, tipoControl: string): Promise<void> {
    const comment = `DATAFAST:${co.nombreCompleto}`;
    if (tipoControl === 'pppoe') {
      // Fix 3: error explícito en lugar de return silencioso
      if (!co.usuarioPppoe) throw new Error('El contrato no tiene usuario PPPoE asignado');
      const password = co.passwordPppoe ? decrypt(co.passwordPppoe) : '';
      await this.pppoeSvc.crear(creds, {
        name: co.usuarioPppoe, password,
        profile: co.pppProfile ?? 'default',
        service: 'pppoe',
        remoteAddress: co.ipAsignada || undefined,
        comment, disabled: false,
      });
    } else if (tipoControl === 'amarre_ip_mac' || tipoControl === 'amarre_ip_mac_dhcp') {
      // Fix 3: error explícito en lugar de return silencioso
      if (!co.ipAsignada || !co.macAddress) throw new Error(`Amarre IP/MAC requiere IP (${co.ipAsignada ?? 'sin asignar'}) y MAC (${co.macAddress ?? 'sin asignar'})`);
      const iface = await this.arpSvc.detectarInterface(creds, co.ipAsignada);
      if (!iface) throw new Error(`No se encontró interfaz para ${co.ipAsignada}`);
      await this.arpSvc.crearArpEstatico(creds, co.ipAsignada, co.macAddress, iface, comment);
      if (tipoControl === 'amarre_ip_mac_dhcp') {
        try {
          await this.firewallSvc.crearDhcpBinding(creds, {
            macAddress: co.macAddress, ipAddress: co.ipAsignada,
            hostname: co.nombreCompleto, comment,
          });
        } catch (dhcpErr) {
          await this.arpSvc.eliminarArpEstatico(creds, co.ipAsignada).catch(() => {});
          throw dhcpErr;
        }
      }
    }
  }

  // ─── OBSERVABILIDAD ───────────────────────────────────────

  async getDriftDetectado(empresaId: string, limit = 100): Promise<{
    id: string;
    contratoId: string;
    routerNombre: string;
    tipoDrift: string;
    usuarioPppoe: string | null;
    ipAsignada: string | null;
    estado: string;
    detectadoEn: string;
    resueltoEn: string | null;
  }[]> {
    return this.ds.query<any[]>(`
      SELECT
        d.id::TEXT               AS id,
        d.contrato_id::TEXT      AS "contratoId",
        ro.nombre                AS "routerNombre",
        d.tipo_drift             AS "tipoDrift",
        d.usuario_pppoe          AS "usuarioPppoe",
        d.ip_asignada            AS "ipAsignada",
        d.estado                 AS estado,
        d.detectado_en           AS "detectadoEn",
        d.resuelto_en            AS "resueltoEn"
      FROM drift_detectado d
      JOIN routers ro ON ro.id = d.router_id
      WHERE ro.empresa_id = $1
      ORDER BY d.detectado_en DESC
      LIMIT $2
    `, [empresaId, limit]);
  }

  async getCbDetail(routerId: string, empresaId: string) {
    await this.findOne(routerId, empresaId); // valida pertenencia a empresa
    return this.pool.getCbDetail(routerId);
  }

  async resetCb(routerId: string, empresaId: string): Promise<void> {
    await this.findOne(routerId, empresaId);
    this.pool.resetCb(routerId);
  }
}
