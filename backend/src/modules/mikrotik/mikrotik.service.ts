import {
  Injectable, Logger, NotFoundException,
  BadRequestException, ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository }       from 'typeorm';
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
import { InterfaceService }                        from './services/interface.service';
import { SubnetRouteService }                      from './services/subnet-route.service';
import { AuditoriaService }                        from '../auth/auditoria.service';
import { VpnClienteService }                       from '../openvpn/services/vpn-cliente.service';
import { JwtPayload }                              from '../../common/decorators/current-user.decorator';
import { encrypt, decrypt }                        from '../../common/utils/encryption.util';

import {
  CreateRouterDto, UpdateRouterDto, ProvisionarClienteDto,
  SuspenderClienteDto, ReactivarClienteDto, AmareIpMacDto,
  TestConexionDirectaDto,
} from './dto/mikrotik.dto';

// ─── Evento emitido al suspender/reactivar ────────────────────
export const EVENT_CLIENTE_SUSPENDIDO  = 'mikrotik.cliente.suspendido';
export const EVENT_CLIENTE_REACTIVADO  = 'mikrotik.cliente.reactivado';

@Injectable()
export class MikrotikService {
  private readonly logger = new Logger(MikrotikService.name);

  constructor(
    @InjectRepository(Router)
    private readonly routerRepo:  Repository<Router>,
    private readonly pool:        RouterConnectionPool,
    private readonly pppoeSvc:    PppoeService,
    private readonly queueSvc:    QueueService,
    private readonly firewallSvc: FirewallService,
    private readonly ifaceSvc:    InterfaceService,
    private readonly subnetSvc:   SubnetRouteService,
    private readonly auditoria:   AuditoriaService,
    private readonly events:      EventEmitter,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly vpnSvc:      VpnClienteService,
  ) {}

  // ────────────────────────────────────────────────────────────
  // GESTIÓN DE ROUTERS
  // ────────────────────────────────────────────────────────────

  async crearRouter(dto: CreateRouterDto, user: JwtPayload): Promise<Router> {
    let passwordCifrado: string;
    try {
      passwordCifrado = encrypt(dto.password);
    } catch {
      passwordCifrado = dto.password;
    }

    const updateFields = {
      nombre:               dto.nombre,
      ubicacion:            dto.ubicacion,
      descripcion:          dto.descripcion,
      ipGestion:            dto.ipGestion,
      vpnIp:                dto.vpnIp ?? dto.ipGestion,
      usuario:              dto.usuario,
      passwordCifrado,
      puertoApi:            dto.puertoApi ?? 8728,
      versionRos:           (dto.versionRos as VersionRouterOS) ?? VersionRouterOS.DESCONOCIDA,
      tipoControl:          (dto.tipoControl ?? TipoControl.NINGUNA) as TipoControl,
      tipoControlVelocidad: (dto.tipoControlVelocidad ?? TipoControlVelocidad.NINGUNO) as TipoControlVelocidad,
      activo:               true,
    };

    // Verificar conflicto de ipGestion
    const existePorIp = await this.routerRepo.findOne({
      where: { ipGestion: dto.ipGestion, empresaId: user.empresaId, deletedAt: null as any },
    });

    if (existePorIp) {
      if (dto.metodoConexion === MetodoConexion.VPN_TUNNEL) {
        const vpnCn = `df_router_id_${existePorIp.id}`;
        await this.routerRepo.update(existePorIp.id, { ...updateFields, vpnCommonName: vpnCn } as any);
        const updated = await this.findOne(existePorIp.id, user.empresaId);
        this.detectarVersionAsync(updated);
        this.inyectarReglasMorososAsync(updated);
        this.vpnSvc.generarParaRouter(updated).catch(e =>
          this.logger.error(`[VPN-CCD] router ${existePorIp.id}: ${e.message}`)
        );
        await this.auditoria.logCreate({
          empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
          modulo: 'mikrotik', entidadId: existePorIp.id,
          descripcion: `Router VPN registrado: ${dto.nombre} (${dto.ipGestion})`,
        });
        return updated;
      }
      throw new ConflictException(`Ya existe un router con IP ${dto.ipGestion}`);
    }

    if (dto.metodoConexion === MetodoConexion.VPN_TUNNEL && dto.vpnIp && dto.vpnIp !== dto.ipGestion) {
      const existePorVpnIp = await this.routerRepo.findOne({
        where: { vpnIp: dto.vpnIp, empresaId: user.empresaId, deletedAt: null as any },
      });
      if (existePorVpnIp) {
        const vpnCn = `df_router_id_${existePorVpnIp.id}`;
        await this.routerRepo.update(existePorVpnIp.id, { ...updateFields, vpnCommonName: vpnCn } as any);
        const updated = await this.findOne(existePorVpnIp.id, user.empresaId);
        this.detectarVersionAsync(updated);
        this.inyectarReglasMorososAsync(updated);
        this.vpnSvc.generarParaRouter(updated).catch(e =>
          this.logger.error(`[VPN-CCD] router ${existePorVpnIp.id}: ${e.message}`)
        );
        await this.auditoria.logCreate({
          empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
          modulo: 'mikrotik', entidadId: existePorVpnIp.id,
          descripcion: `Router VPN registrado: ${dto.nombre} (${dto.vpnIp})`,
        });
        return updated;
      }
    }

    const router = this.routerRepo.create({
      ...dto,
      passwordCifrado,
      empresaId: user.empresaId,
      estado:    EstadoEquipo.DESCONOCIDO,
    });
    const saved = await this.routerRepo.save(router);
    this.detectarVersionAsync(saved);
    this.inyectarReglasMorososAsync(saved);

    if (dto.metodoConexion === MetodoConexion.VPN_TUNNEL) {
      if (dto.vpnClienteId) {
        // Vincular cert del wizard directamente — evita generar un cert UUID huérfano
        await this.vpnSvc.vincularCertWizardARouter(dto.vpnClienteId, saved.id, user.empresaId)
          .catch(e => this.logger.error(`[VPN-CCD] vincular wizard cert router ${saved.id}: ${e.message}`));
      } else {
        const vpnCn = `df_router_id_${saved.id}`;
        await this.routerRepo.update(saved.id, { vpnCommonName: vpnCn } as any);
        this.vpnSvc.generarParaRouter(await this.findOne(saved.id, user.empresaId)).catch(e =>
          this.logger.error(`[VPN-CCD] router ${saved.id}: ${e.message}`)
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

    // Esperar que detectarVersionAsync actualice estado antes de responder
    await new Promise(r => setTimeout(r, 3000));
    return this.findOne(saved.id, user.empresaId);
  }

  async findAll(empresaId: string): Promise<(Router & { contratosCount: number })[]> {
    const routers = await this.routerRepo.find({
      where: { empresaId, activo: true, deletedAt: null as any },
      order: { nombre: 'ASC' },
    });
    if (!routers.length) return [];

    const rows: { router_id: string; count: string }[] = await this.ds.query(
      `SELECT router_id, COUNT(*) AS count
       FROM contratos
       WHERE router_id = ANY($1)
         AND estado IN ('activo','suspendido_mora','suspendido_manual','prorroga')
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
    const router = await this.findOne(id, user.empresaId);
    const updates: Partial<Router> = { ...dto } as any;

    const rawPass = (dto as any).password;
    if (rawPass && rawPass !== '***stored***') {
      try { updates.passwordCifrado = encrypt(rawPass); }
      catch { updates.passwordCifrado = rawPass; }
    }
    delete (updates as any).password;
    // vpn_common_name es inmutable — identifica el túnel en el servidor OpenVPN.
    // Cambiar el nombre comercial del router no debe alterar ni el CCD ni el certificado.
    delete (updates as any).vpnCommonName;

    await this.routerRepo.update(id, updates);
    // Invalidar conexiones existentes si cambió la IP o contraseña
    if (dto.ipGestion || (dto as any).password) {
      await this.pool.invalidate(id);
    }
    const updated = await this.findOne(id, user.empresaId);
    // Re-sincronizar subnets si cambió la IP de gestión/VPN
    if (dto.ipGestion || dto.vpnIp) this.syncSubnetsAsync(updated);
    this.inyectarReglasMorososAsync(updated);
    return updated;
  }

  async removeRouter(id: string, user: JwtPayload): Promise<void> {
    const router = await this.findOne(id, user.empresaId);

    // Protección: impedir borrado si existen contratos activos/suspendidos
    const [{ count: countContratos }] = await this.ds.query(
      `SELECT COUNT(*) AS count FROM contratos
       WHERE router_id = $1
         AND estado IN ('activo','suspendido_mora','suspendido_manual','prorroga')
         AND deleted_at IS NULL`,
      [id],
    );

    // Protección: impedir borrado si hay dispositivos monitoreados dependiendo de este router
    const [{ count: countDispositivos }] = await this.ds.query(
      `SELECT COUNT(*) AS count FROM dispositivos_monitoreo
       WHERE router_acceso_id = $1
         AND deleted_at IS NULL`,
      [id],
    );

    const bloqueadores: string[] = [];
    if (Number(countContratos) > 0)
      bloqueadores.push(`${countContratos} abonado(s) con servicio activo`);
    if (Number(countDispositivos) > 0)
      bloqueadores.push(`${countDispositivos} equipo(s) monitoreado(s) (antenas, cámaras u otros)`);

    if (bloqueadores.length > 0) {
      throw new BadRequestException(
        `No es posible eliminar este router porque tiene: ${bloqueadores.join(' y ')}. ` +
        `Reasigna o elimina estos elementos antes de continuar.`,
      );
    }

    // Eliminar rutas del VPS al borrar el router
    if (router.subnetsLocales?.length) {
      const gw = router.vpnIp || router.ipGestion;
      await this.subnetSvc.removeVpsRoutes(gw, router.subnetsLocales);
    }
    await this.routerRepo.update(id, { deletedAt: new Date(), activo: false });
    await this.pool.invalidate(id);

    // Desactivar segmentos de red vinculados a este router
    try {
      await this.ds.query(
        `UPDATE segmentos_ipv4 SET activo = false WHERE router_id = $1 AND deleted_at IS NULL`,
        [id],
      );
    } catch (err: any) {
      this.logger.warn(`Error desactivando segmentos del router ${id}: ${err.message}`);
    }

    // Revocar certificados VPN vinculados a este router
    try {
      const vpnClientes = await this.vpnSvc.listarPorRouterId(id, user.empresaId);
      for (const c of vpnClientes) {
        await this.vpnSvc.revocar(c.id, user.empresaId);
        this.logger.log(`VPN cliente revocado al eliminar router ${id}: ${c.id}`);
      }
    } catch (err: any) {
      this.logger.warn(`Error revocando VPN clientes del router ${id}: ${err.message}`);
    }
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
  ): Promise<{ mensaje: string; procesados: number; morosos: number }> {
    const router = await this.findOne(routerId, empresaId);
    this.logger.log(
      `[REPARAR] Iniciando reparación del router "${router.nombre}" ` +
      `(${router.vpnIp || router.ipGestion}) — ROS ${router.versionRos}`,
    );

    // ── BLOQUE 0: Consulta masiva de contratos + planes ──────
    // Una sola query extrae todo lo necesario para los 6 bucles:
    // PPP profiles, PPPoE secrets, ARP, DHCP leases, queues, morosos
    const contratos: any[] = await this.ds.query(
      `SELECT
         c.id,
         c.usuario_pppoe,
         c.ip_asignada,
         c.mac_address,
         c.estado,
         p.nombre           AS plan_nombre,
         p.velocidad_bajada AS bajada_kbps,
         p.velocidad_subida AS subida_kbps,
         p.burst_bajada     AS burst_bajada,
         p.burst_subida     AS burst_subida,
         p.burst_umbral     AS burst_umbral,
         p.burst_tiempo     AS burst_tiempo,
         COALESCE(p.rate_limit, p.velocidad_bajada::text || 'k/' || p.velocidad_subida::text || 'k') AS rate_limit,
         COALESCE(p.ppp_profile, 'Datafast-' || p.nombre) AS ppp_profile_name
       FROM contratos c
       JOIN planes p ON p.id = c.plan_id AND p.deleted_at IS NULL
       WHERE c.router_id   = $1
         AND c.deleted_at  IS NULL
         AND c.estado IN ('activo','suspendido_mora','suspendido_manual','prorroga','pendiente_instalacion')
       ORDER BY c.usuario_pppoe ASC`,
      [routerId],
    );

    const morososList = contratos.filter(
      (c) => c.estado === 'suspendido_mora' || c.estado === 'suspendido_manual',
    );

    this.logger.log(
      `[REPARAR] ${contratos.length} contratos cargados — ${morososList.length} morosos`,
    );

    // ── CONDICIONAL DE VERSIÓN ───────────────────────────────
    if (router.versionRos === VersionRouterOS.V7) {
      // ┌─ RouterOS v7 ─────────────────────────────────────────
      // │  /queue/simple  →  target=<IP>/32  max-limit=<U>/<D>
      // │  /ppp/profile   →  rate-limit="<D>k/<U>k" (sin burst-limit separado en v7 básico)
      // └──────────────────────────────────────────────────────
      this.logger.log('[REPARAR_V7] Modo RouterOS v7 activado');

      // BLOQUE 1 – Perfiles PPP  (/ppp/profile)
      // Lógica: Actualizar si existe (por name con firma) / Crear si no
      // API v7: /ppp/profile/add name="Datafast-<plan>" rate-limit="<D>k/<U>k"
      //         comment="Datafast - Plan <nombre>"
      for (const plan of this.planesUnicos(contratos)) {
        this.logger.log(
          `[REPARAR_V7][PPP_PROFILE] /ppp/profile/add` +
          ` name="Datafast-${plan.plan_nombre}"` +
          ` rate-limit="${plan.bajada_kbps}k/${plan.subida_kbps}k"` +
          ` comment="Datafast - Plan ${plan.plan_nombre}"`,
        );
      }

      // BLOQUE 2 – Secretos PPPoE  (/ppp/secret)
      // API v7: /ppp/secret/add name=<usuario> password=*** service=pppoe
      //         profile="Datafast-<plan>" remote-address=<ip>
      //         comment="Datafast - Contrato #<id>"
      for (const c of contratos) {
        if (!c.usuario_pppoe) continue;
        this.logger.log(
          `[REPARAR_V7][PPP_SECRET] usuario="${c.usuario_pppoe}"` +
          ` profile="Datafast-${c.plan_nombre}"` +
          ` ip="${c.ip_asignada}"` +
          ` comment="Datafast - Contrato #${c.id}"`,
        );
      }

      // BLOQUE 3 – Colas Simples  (/queue/simple)
      // v7: target=<IP>/32  max-limit=<upload>/<download>
      //     name="Datafast-<usuario>" comment="Datafast - Contrato #<id>"
      for (const c of contratos) {
        if (!c.ip_asignada) continue;
        this.logger.log(
          `[REPARAR_V7][QUEUE] /queue/simple/add` +
          ` name="Datafast-${c.usuario_pppoe}"` +
          ` target="${c.ip_asignada}/32"` +
          ` max-limit="${c.subida_kbps}k/${c.bajada_kbps}k"` +
          ` comment="Datafast - Contrato #${c.id}"`,
        );
      }

      // BLOQUE 4 – Lista morosos  (/ip/firewall/address-list)
      // address-list="morosos-datafast"  (firma Datafast)
      // Solo contratos en estado suspendido_mora o suspendido_manual
      for (const c of morososList) {
        this.logger.log(
          `[REPARAR_V7][MOROSOS] /ip/firewall/address-list/add` +
          ` list="morosos-datafast"` +
          ` address="${c.ip_asignada}"` +
          ` comment="Datafast - Contrato #${c.id}"`,
        );
      }

    } else {
      // ┌─ RouterOS v6 (legacy) ────────────────────────────────
      // │  /queue/simple  →  target-addresses=<IP>/32  dst-address=0.0.0.0/0
      // │                     max-limit=<D>/<U>  (bajada/subida invertidos en v6)
      // │  /ppp/profile   →  rate-limit="<D>k/<U>k" con burst separado
      // └──────────────────────────────────────────────────────
      this.logger.log('[REPARAR_V6] Modo RouterOS v6 activado');

      // BLOQUE 1 – Perfiles PPP  (/ppp/profile)
      // API v6: /ppp/profile/add name="Datafast-<plan>"
      //         rate-limit="<D>k/<U>k" comment="Datafast - Plan <nombre>"
      for (const plan of this.planesUnicos(contratos)) {
        const burst = plan.burst_bajada
          ? ` burst-limit="${plan.burst_bajada}k/${plan.burst_subida}k"` +
            ` burst-threshold="${plan.burst_umbral}k/${plan.burst_umbral}k"` +
            ` burst-time="${plan.burst_tiempo}/${plan.burst_tiempo}"`
          : '';
        this.logger.log(
          `[REPARAR_V6][PPP_PROFILE] /ppp/profile/add` +
          ` name="Datafast-${plan.plan_nombre}"` +
          ` rate-limit="${plan.bajada_kbps}k/${plan.subida_kbps}k"` +
          `${burst}` +
          ` comment="Datafast - Plan ${plan.plan_nombre}"`,
        );
      }

      // BLOQUE 2 – Secretos PPPoE  (/ppp/secret)
      for (const c of contratos) {
        if (!c.usuario_pppoe) continue;
        this.logger.log(
          `[REPARAR_V6][PPP_SECRET] /ppp/secret/add` +
          ` name="${c.usuario_pppoe}"` +
          ` service=pppoe` +
          ` profile="Datafast-${c.plan_nombre}"` +
          ` remote-address="${c.ip_asignada}"` +
          ` comment="Datafast - Contrato #${c.id}"`,
        );
      }

      // BLOQUE 3 – Amarres ARP  (/ip/arp)
      // Solo cuando tipoControl != pppoe_addresslist y hay MAC asignada
      // comment="Datafast - Contrato #<id>"
      if (router.tipoControl !== TipoControl.PPPOE_ADDRESSLIST) {
        for (const c of contratos) {
          if (!c.ip_asignada || !c.mac_address) continue;
          this.logger.log(
            `[REPARAR_V6][ARP] /ip/arp/add` +
            ` address="${c.ip_asignada}"` +
            ` mac-address="${c.mac_address}"` +
            ` comment="Datafast - Contrato #${c.id}"`,
          );
        }
      }

      // BLOQUE 4 – Arrendamientos DHCP  (/ip/dhcp-server/lease)
      // Solo si tipoControl === amarre_ip_mac_dhcp
      if (router.tipoControl === TipoControl.AMARRE_IP_MAC_DHCP) {
        for (const c of contratos) {
          if (!c.ip_asignada || !c.mac_address) continue;
          this.logger.log(
            `[REPARAR_V6][DHCP_LEASE] /ip/dhcp-server/lease/add` +
            ` address="${c.ip_asignada}"` +
            ` mac-address="${c.mac_address}"` +
            ` comment="Datafast - Contrato #${c.id}"`,
          );
        }
      }

      // BLOQUE 5 – Colas Simples  (/queue/simple)
      // v6: target-addresses=<IP>/32 dst-address=0.0.0.0/0 max-limit=<D>/<U>
      for (const c of contratos) {
        if (!c.ip_asignada) continue;
        this.logger.log(
          `[REPARAR_V6][QUEUE] /queue/simple/add` +
          ` name="Datafast-${c.usuario_pppoe}"` +
          ` target-addresses="${c.ip_asignada}/32"` +
          ` dst-address=0.0.0.0/0` +
          ` max-limit="${c.bajada_kbps}k/${c.subida_kbps}k"` +
          ` comment="Datafast - Contrato #${c.id}"`,
        );
      }

      // BLOQUE 6 – Lista morosos  (/ip/firewall/address-list)
      for (const c of morososList) {
        this.logger.log(
          `[REPARAR_V6][MOROSOS] /ip/firewall/address-list/add` +
          ` list="morosos-datafast"` +
          ` address="${c.ip_asignada}"` +
          ` comment="Datafast - Contrato #${c.id}"`,
        );
      }
    }

    this.logger.log(
      `[REPARAR] Reparación de "${router.nombre}" completada (modo simulado). ` +
      `${contratos.length} contratos procesados, ${morososList.length} morosos.`,
    );

    return {
      mensaje:
        `Reparación completada (modo simulado) para "${router.nombre}". ` +
        `${contratos.length} contratos procesados, ` +
        `${morososList.length} IPs sincronizadas en morosos-datafast.`,
      procesados: contratos.length,
      morosos:    morososList.length,
    };
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
  // PROVISIONAR CLIENTE EN MIKROTIK
  // Orquesta: PPPoE + Queue + Firewall rules
  // ────────────────────────────────────────────────────────────
  async provisionarCliente(
    routerId: string,
    dto:      ProvisionarClienteDto,
    user:     JwtPayload,
  ): Promise<{ ppppoeId: string; queueId: string }> {
    const creds = await this.getCredentials(routerId, user.empresaId);

    this.logger.log(
      `Provisionando cliente en ${creds.ip}: PPPoE=${dto.usuarioPppoe} | IP=${dto.ipAsignada} | ` +
      `${dto.uploadMbps}/${dto.downloadMbps} Mbps`,
    );

    // ── 1. Crear usuario PPPoE ─────────────────────────────
    const ppppoeId = await this.pppoeSvc.crear(creds, {
      name:          dto.usuarioPppoe,
      password:      dto.passwordPppoe,
      profile:       dto.perfilPppoe || 'default',
      service:       'pppoe',
      remoteAddress: dto.ipAsignada,
      comment:       `DATAFAST:ClienteID:${dto.clienteId}`,
      disabled:      false,
    });

    // ── 2. Crear Simple Queue (o PCQ si está configurado) ──
    const hasQueue = dto.tipoQueue === 'simple_queue' || !dto.tipoQueue;
    let queueId = '';

    if (hasQueue) {
      queueId = await this.queueSvc.crearSimpleQueue(creds, {
        name:         dto.usuarioPppoe,
        target:       `${dto.ipAsignada}/32`,
        maxLimitDown: dto.downloadMbps,
        maxLimitUp:   dto.uploadMbps,
        burstLimitDown: dto.burstDownMbps,
        burstLimitUp:   dto.burstUpMbps,
        burstTimeDown:  dto.burstTiempoSegundos,
        burstTimeUp:    dto.burstTiempoSegundos,
        comment:       `DATAFAST:ClienteID:${dto.clienteId}`,
      });
    } else if (dto.tipoQueue === 'queue_tree' || dto.tipoQueue === 'pcq') {
      // Verificar si PCQ está configurado, si no, configurarlo primero
      const tienePcq = await this.queueSvc.tienePcqConfigurado(creds);
      if (!tienePcq) {
        await this.queueSvc.configurarPcqCompleto(creds, {
          namePrefix:   'datafast',
          downloadMbps: dto.downloadMbps * 10, // límite total del nodo
          uploadMbps:   dto.uploadMbps * 10,
        });
      }
      // El PCQ ya maneja el cliente automáticamente por IP
    }

    // ── 3. Asegurar que las reglas de control están activas ─
    if (user.empresaId) {
      await this.firewallSvc.configurarReglasControl(creds).catch((err) =>
        this.logger.warn(`No se pudieron verificar reglas firewall: ${err.message}`),
      );
    }

    await this.auditoria.log({
      empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      accion: 'PROVISION', modulo: 'mikrotik', entidadId: dto.clienteId,
      descripcion: `PPPoE ${dto.usuarioPppoe} provisionado en ${creds.ip} | IP: ${dto.ipAsignada}`,
    });

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
    const creds = await this.getCredentials(routerId, user.empresaId);

    // 1. Agregar a Address List morosos
    await this.firewallSvc.suspenderCliente(
      creds, dto.ipAsignada, dto.clienteId,
      `Mora - ${new Date().toLocaleDateString('es-PE')}`,
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
      this.ifaceSvc.getRecursos(creds),
      this.ifaceSvc.listarInterfaces(creds),
      this.pppoeSvc.contarSesionesActivas(creds).catch(() => 0),
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

      return { exitoso: true, mensaje: `Conectado a "${identity}" en ${latencia}ms`, latenciaMs: latencia };

    } catch (error) {
      await this.routerRepo.update(routerId, { estado: EstadoEquipo.OFFLINE });
      return { exitoso: false, mensaje: `No se pudo conectar: ${error.message}` };
    }
  }

  // ────────────────────────────────────────────────────────────
  // TEST DE CONEXIÓN DIRECTA (antes de guardar el router)
  // ────────────────────────────────────────────────────────────

  async testConexionDirecta(dto: TestConexionDirectaDto): Promise<{
    exitoso: boolean;
    mensaje: string;
    latenciaMs?: number;
    versionDetectada?: string;
    identityDetectada?: string;
    rosVersion?: string;
  }> {
    // ── Resolver contraseña: sentinel '***stored***' → leer de BD ─
    let resolvedPassword = dto.password ?? '';
    if ((!resolvedPassword || resolvedPassword === '***stored***') && dto.routerId) {
      const stored = await this.routerRepo.findOne({ where: { id: dto.routerId } });
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
    if (m.includes('timeout'))                          return 'Timeout — verificar IP, puerto y firewall del router';
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
      timeoutSec:      15,
      version:         router.versionRos === VersionRouterOS.V7 ? 'v7' : 'v6',
    };

    this.firewallSvc.configurarReglasControl(creds)
      .then(() => this.logger.log(`Reglas de control aplicadas: ${ip}`))
      .catch((err) => this.logger.warn(`No se pudieron aplicar reglas en ${ip}: ${err.message}`));
  }

  // ────────────────────────────────────────────────────────────
  // POLLING DE MÉTRICAS (CPU/RAM/sesiones) — cada 5 minutos
  // Solo se ejecuta en la instancia 0 del clúster PM2
  // ────────────────────────────────────────────────────────────
  @Cron('*/5 * * * *', { timeZone: 'America/Lima' })
  async pollRouterMetrics(): Promise<void> {
    if (process.env.NODE_APP_INSTANCE !== undefined && process.env.NODE_APP_INSTANCE !== '0') return;

    let routers: Router[];
    try {
      routers = await this.routerRepo.find({
        where: { activo: true, deletedAt: null as any },
      });
    } catch { return; }

    const pollOne = async (router: Router): Promise<void> => {
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

        const esPppoe = router.tipoControl === TipoControl.PPPOE_ADDRESSLIST;
        const [recursos, sesionesCount] = await Promise.all([
          this.ifaceSvc.getRecursos(creds),
          esPppoe
            ? this.pppoeSvc.contarSesionesActivas(creds).catch(() => 0)
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
      } catch {
        await this.routerRepo.update(router.id, {
          estado:             EstadoEquipo.OFFLINE,
          cpuUsoPct:          null,
          memoriaUsoPct:      null,
          totalSesionesPppoe: 0,
        });
      }
    };

    const CHUNK = 4;
    for (let i = 0; i < routers.length; i += CHUNK) {
      await Promise.allSettled(routers.slice(i, i + CHUNK).map(pollOne));
    }
  }

  // ── Detectar versión RouterOS de forma asíncrona ──────────
  private detectarVersionAsync(router: Router): void {
    const creds: RouterCredentials = {
      id:              router.id,
      ip:              router.vpnIp || router.ipGestion,
      port:            router.usarSsl ? router.puertoApiSsl : router.puertoApi,
      user:            router.usuario,
      passwordCifrado: router.passwordCifrado,
      useSsl:          router.usarSsl,
      timeoutSec:      10,
      version:         'v6',
    };

    this.ifaceSvc.detectarVersion(creds)
      .then((version) => {
        const rosVersion = version === 'v7' ? VersionRouterOS.V7 : VersionRouterOS.V6;
        return this.routerRepo.update(router.id, {
          versionRos: rosVersion,
          estado:     EstadoEquipo.ONLINE,
          ultimoPing: new Date(),
        });
      })
      .catch((err) => {
        this.logger.warn(`No se pudo conectar a ${router.vpnIp || router.ipGestion}: ${err.message}`);
        return this.routerRepo.update(router.id, { estado: EstadoEquipo.OFFLINE });
      });
  }
}
