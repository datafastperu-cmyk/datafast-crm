import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource }                 from '@nestjs/typeorm';
import { DataSource }                       from 'typeorm';
import { EventEmitter2 }                    from '@nestjs/event-emitter';
import { ModuleHealthService }              from '../../common/services/module-health.service';
import { RedisLockService }               from '../../common/redis/redis-lock.service';

import { WhatsAppService }        from '../notificaciones/services/whatsapp.service';
import { PppoeService }           from '../mikrotik/services/pppoe.service';
import { QueueService }           from '../mikrotik/services/queue.service';
import { ArpService }             from '../mikrotik/services/arp.service';
import { FirewallService }        from '../mikrotik/services/firewall.service';
import { VelocidadOrquestador }   from '../mikrotik/services/velocidad/velocidad-orquestador.service';
import { TipoControl }            from '../mikrotik/entities/router.entity';
import { SmartoltApiService }     from '../smartolt/smartolt-api.service';
import { OltMetodoConexion }      from '../olt-nativo/entities/olt-dispositivo.entity';
import { OltProviderFactory }     from '../olt-provider/olt-provider.factory';
import { OltConexion }            from '../olt-provider/interfaces/olt-provider.interface';
import { JwtPayload }             from '../../common/decorators/current-user.decorator';
import { decrypt }                from '../../common/utils/encryption.util';
import { getNextAvailableIp }     from '../../common/utils/ip.util';

import {
  AprovisionarFtthDto,
  RollbackAprovisionamientoDto,
  AprovisionamientoResultadoDto,
  PasoResultadoDto,
} from './aprovisionamiento.dto';

// ─── Contexto compartido entre pasos ─────────────────────────
interface Ctx {
  // Del contrato/BD
  contrato?:        any;
  cliente?:         any;
  plan?:            any;
  router?:          any;
  olt?:             any;
  // Resultados de pasos
  ipAsignada?:      string;
  usuarioPppoe?:    string;
  passwordPppoePlain?: string;
  serialNumber?:    string;
  onuId?:           string;          // ID en nuestra BD
  smartoltOnuId?:   string;          // ID en SmartOLT
  // Flags para rollback
  ipRegistradaEnBd:  boolean;
  pppoeCreado:       boolean;
  arpCreado:         boolean;
  dhcpLeaseCreado:   boolean;
  queueCreada:       boolean;
  onuAprovisionada:  boolean;
  onuRegistradaEnBd: boolean;
  contratoActivado:  boolean;
  // Proveedor OLT activo
  oltConexion?:      OltConexion;
  oltMetodo?:        OltMetodoConexion;
}

// Máximo tiempo esperando el semáforo de un router (ms)
const ROUTER_LOCK_TIMEOUT_MS = 30_000;

// ─────────────────────────────────────────────────────────────
// OrquestadorAprovisionamiento
//
// Implementa los 8 pasos del flujo FTTH con:
// - Contexto compartido entre pasos (ctx)
// - Rollback automático si rollbackEnError = true
// - Notificación WhatsApp al cliente al finalizar
// - Auditoría de cada paso
// - Evento EventEmitter2 al completar (para WebSocket broadcast)
// ─────────────────────────────────────────────────────────────
@Injectable()
export class OrquestadorAprovisionamientoService implements OnModuleInit {
  private readonly logger = new Logger(OrquestadorAprovisionamientoService.name);

  private degraded      = false;
  private degradedReason: string | null = null;

  constructor(
    private readonly pppoeSvc:     PppoeService,
    private readonly queueSvc:     QueueService,
    private readonly arpSvc:       ArpService,
    private readonly firewallSvc:  FirewallService,
    private readonly velocidadOrc: VelocidadOrquestador,
    private readonly smartoltApi:  SmartoltApiService,
    private readonly oltFactory:   OltProviderFactory,
    private readonly whatsapp:     WhatsAppService,
    private readonly events:       EventEmitter2,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly moduleHealth: ModuleHealthService,
    private readonly redisLock:    RedisLockService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ds.query(`SELECT 1 FROM contratos LIMIT 0`);
      this.moduleHealth.registrar('aprovisionamiento', 'ok');
    } catch (err: any) {
      this.degraded       = true;
      this.degradedReason = err.message;
      this.moduleHealth.registrar('aprovisionamiento', 'degraded', err.message);
    }
  }

  isDegraded():        boolean       { return this.degraded; }
  getDegradedReason(): string | null { return this.degradedReason; }

  // Serializa llamadas al mismo router vía Redis lock distribuido.
  // Protege contra race conditions entre el proceso API y el worker de cobranza.
  // TTL = timeout + 5s como margen de seguridad ante crashes sin finally.
  private async withRouterLock<T>(routerId: string, fn: () => Promise<T>): Promise<T> {
    return this.redisLock.withLock(
      `router:${routerId}`,
      ROUTER_LOCK_TIMEOUT_MS + 5_000,
      fn,
    );
  }

  // ────────────────────────────────────────────────────────────
  // PUNTO DE ENTRADA PRINCIPAL
  // ────────────────────────────────────────────────────────────
  async ejecutar(
    dto:  AprovisionarFtthDto,
    user: JwtPayload,
  ): Promise<AprovisionamientoResultadoDto> {
    if (this.degraded) {
      return {
        pasos:             [],
        exitoso:           false,
        contratoId:        dto.contratoId,
        mensajeFinal:      `Módulo de aprovisionamiento no disponible: ${this.degradedReason ?? 'error de esquema en BD'}`,
        rollbackEjecutado: false,
        pasosFallidos:     [],
      };
    }

    const inicio = Date.now();

    const resultado: AprovisionamientoResultadoDto = {
      pasos:          [],
      exitoso:        false,
      contratoId:     dto.contratoId,
      mensajeFinal:   '',
      rollbackEjecutado: false,
      pasosFallidos:  [],
    };

    // Contexto mutable compartido entre pasos
    const ctx: Ctx = {
      ipRegistradaEnBd:  false,
      pppoeCreado:       false,
      arpCreado:         false,
      dhcpLeaseCreado:   false,
      queueCreada:       false,
      onuAprovisionada:  false,
      onuRegistradaEnBd: false,
      contratoActivado:  false,
    };

    // ─── Definición de los 8 pasos ────────────────────────────
    const pasos: Array<{
      num:    number;
      nombre: string;
      fn:     (ctx: Ctx) => Promise<{ detalle: string; datos?: Record<string, any> }>;
    }> = [

      // ══════════════════════════════════════════════════════
      // PASO 1 — Validar y cargar datos del contrato
      // ══════════════════════════════════════════════════════
      {
        num: 1,
        nombre: 'Validar contrato, cliente, plan y red',
        fn: async (ctx) => {
          const rows = await this.ds.query(`
            SELECT
              co.id               AS contrato_id,
              co.numero_contrato,
              co.estado           AS contrato_estado,
              co.aprovisionado,
              co.usuario_pppoe,
              co.password_pppoe,
              co.ip_asignada,
              co.mac_address,
              co.tipo_servicio    AS contrato_tipo_servicio,
              co.plan_id,
              co.segmento_id,
              cl.id               AS cliente_id,
              cl.nombre_completo  AS cliente_nombre,
              cl.telefono         AS cliente_telefono,
              cl.email            AS cliente_email,
              cl.whatsapp         AS cliente_whatsapp,
              pl.nombre           AS plan_nombre,
              pl.velocidad_bajada,
              pl.velocidad_subida,
              pl.burst_bajada,
              pl.burst_subida,
              pl.burst_tiempo,
              pl.tipo_queue,
              pl.ppp_profile,
              pl.tipo             AS plan_tipo,
              pl.precio           AS plan_precio,
              ro.id               AS router_id,
              ro.ip_gestion       AS router_ip,
              ro.version_ros,
              ro.usuario          AS router_usuario,
              ro.password_cifrado AS router_pass,
              ro.usar_ssl,
              ro.puerto_api,
              ro.puerto_api_ssl,
              ro.timeout_conexion,
              ro.auto_configurar_queues,
              ro.tipo_control,
              ol.id               AS olt_id,
              ol.smartolt_id,
              ol.nombre           AS olt_nombre,
              em.razon_social     AS empresa_nombre,
              em.serie_boleta,
              em.igv_rate,
              em.dias_gracia
            FROM contratos  co
            JOIN clientes   cl ON cl.id = co.cliente_id
            JOIN planes     pl ON pl.id = co.plan_id
            JOIN routers    ro ON ro.id = $2
            JOIN olts       ol ON ol.id = $3
            JOIN empresas   em ON em.id = co.empresa_id
            WHERE co.id = $1
              AND co.empresa_id = $4
              AND co.deleted_at IS NULL
          `, [dto.contratoId, dto.routerId, dto.oltId, user.empresaId]);

          if (!rows.length) {
            throw new Error(
              `No se encontró el contrato ${dto.contratoId} con los recursos indicados. ` +
              `Verifica que el router y OLT pertenezcan a la misma empresa.`,
            );
          }

          const row = rows[0];

          // Validar estado del contrato
          if (row.aprovisionado) {
            throw new Error(
              `El contrato ${row.numero_contrato} ya está aprovisionado. ` +
              `Para reaprovisionar, primero haz rollback.`,
            );
          }
          if (row.contrato_estado !== 'activo') {
            throw new Error(
              `El contrato debe estar ACTIVO para aprovisionar la ONU en la OLT. ` +
              `Activa primero el servicio en MikroTik (estado actual: "${row.contrato_estado}").`,
            );
          }
          // ── Cargar OltDispositivo (nativo SSH) si se proporcionó ──
          let oltMetodo = OltMetodoConexion.SMARTOLT_API;
          let oltConexion: OltConexion = {
            externId: row.smartolt_id || row.olt_id,
            marca:    'huawei',
          };

          if (dto.oltDispositivoId) {
            const [oltDisp] = await this.ds.query(
              `SELECT id, metodo_conexion, ip_gestion, puerto, usuario_anclado,
                      contrasena_cifrada, marca::text AS marca, vlan_gestion_defecto
               FROM olt_dispositivos
               WHERE id = $1 AND empresa_id = $2 AND activo = true`,
              [dto.oltDispositivoId, user.empresaId],
            );
            if (!oltDisp) {
              throw new Error(
                `OltDispositivo ${dto.oltDispositivoId} no encontrado o inactivo.`,
              );
            }
            oltMetodo = oltDisp.metodo_conexion as OltMetodoConexion;
            let passClear: string | undefined;
            try { passClear = oltDisp.contrasena_cifrada ? decrypt(oltDisp.contrasena_cifrada) : undefined; }
            catch { passClear = oltDisp.contrasena_cifrada; }

            oltConexion = {
              externId:          oltDisp.id,
              ipGestion:         oltDisp.ip_gestion,
              puerto:            oltDisp.puerto ?? 22,
              usuario:           oltDisp.usuario_anclado,
              contrasenaCifrada: passClear,
              marca:             (oltDisp.marca as string).toLowerCase(),
            };
          } else if (!row.smartolt_id) {
            throw new Error(
              `El OLT "${row.olt_nombre}" no tiene SmartOLT ID configurado. ` +
              `Proporciona oltDispositivoId para usar SSH nativo, o sincroniza desde SmartOLT.`,
            );
          } else {
            oltConexion = { externId: row.smartolt_id, marca: 'huawei' };
          }

          ctx.oltConexion = oltConexion;
          ctx.oltMetodo   = oltMetodo;

          // ── Cargar en contexto ──────────────────────────────
          ctx.contrato     = row;
          ctx.usuarioPppoe = row.usuario_pppoe;
          ctx.ipAsignada   = row.ip_asignada;

          // Descifrar password PPPoE
          try { ctx.passwordPppoePlain = decrypt(row.password_pppoe || ''); }
          catch { ctx.passwordPppoePlain = row.password_pppoe || ''; }

          return {
            detalle: `✓ Contrato ${row.numero_contrato} | Cliente: ${row.cliente_nombre} | Plan: ${row.plan_nombre} (${row.velocidad_bajada}/${row.velocidad_subida} Mbps)`,
            datos: {
              numeroContrato: row.numero_contrato,
              clienteNombre:  row.cliente_nombre,
              planNombre:     row.plan_nombre,
              routerIp:       row.router_ip,
              oltNombre:      row.olt_nombre,
            },
          };
        },
      },

      // ══════════════════════════════════════════════════════
      // PASO 2 — Asignar IP del pool IPv4
      // ══════════════════════════════════════════════════════
      {
        num: 2,
        nombre: 'Asignar IP del pool IPv4',
        fn: async (ctx) => {
          if (ctx.ipAsignada) {
            return { detalle: `IP ya asignada previamente: ${ctx.ipAsignada}` };
          }

          const segmentoId = dto.segmentoId || ctx.contrato.segmento_id;

          if (dto.ipManual) {
            const [ocupada] = await this.ds.query(
              `SELECT id FROM ips_asignadas WHERE ip_address = $1 AND activa = true AND empresa_id = $2`,
              [dto.ipManual, user.empresaId],
            );
            if (ocupada) throw new Error(`La IP ${dto.ipManual} ya está asignada a otro contrato`);
            ctx.ipAsignada = dto.ipManual;
            await this.ds.query(`
              INSERT INTO ips_asignadas
                (empresa_id, segmento_id, contrato_id, ip_address, tipo, activa, asignada_en)
              VALUES ($1, $2, $3, $4, 'cliente', true, NOW())
              ON CONFLICT DO NOTHING
            `, [user.empresaId, segmentoId ?? null, dto.contratoId, ctx.ipAsignada]);
            await this.ds.query(
              'UPDATE contratos SET ip_asignada = $1 WHERE id = $2',
              [ctx.ipAsignada, dto.contratoId],
            );

          } else if (segmentoId) {
            // Advisory lock de nivel de transacción por segmento — evita doble asignación
            const qr = this.ds.createQueryRunner();
            await qr.connect();
            await qr.startTransaction();
            try {
              await qr.query(
                `SELECT pg_advisory_xact_lock(hashtext('ip_pool_' || $1))`,
                [segmentoId],
              );

              const [segmento] = await qr.query(
                `SELECT red_cidr, gateway, ips_reservadas, tipo_servicio FROM segmentos_ipv4
                 WHERE id = $1 AND empresa_id = $2 AND activo = true`,
                [segmentoId, user.empresaId],
              );
              if (!segmento) throw new Error(`Segmento IPv4 ${segmentoId} no encontrado o inactivo`);

              // Validar que el tipo de segmento coincide con el tipo de contrato
              if (
                ctx.contrato.contrato_tipo_servicio &&
                segmento.tipo_servicio !== ctx.contrato.contrato_tipo_servicio
              ) {
                throw new Error(
                  `El segmento "${segmento.red_cidr}" es de tipo "${segmento.tipo_servicio}" ` +
                  `pero el contrato es "${ctx.contrato.contrato_tipo_servicio}". ` +
                  `Los pools WISP y FTTH no se comparten.`,
                );
              }

              const enUso = await qr.query(
                `SELECT ip_address FROM ips_asignadas WHERE segmento_id = $1 AND activa = true`,
                [segmentoId],
              );
              const ipsUsadas    = enUso.map((r: any) => r.ip_address);
              const ipsReservadas = [segmento.gateway, ...(segmento.ips_reservadas || [])].filter(Boolean);

              const ip = getNextAvailableIp(segmento.red_cidr, ipsUsadas, ipsReservadas);
              if (!ip) {
                throw new Error(
                  `Pool IPv4 exhausto en segmento ${segmento.red_cidr}. ` +
                  `Usadas: ${ipsUsadas.length}. Agrega más IPs al pool o usa ipManual.`,
                );
              }
              ctx.ipAsignada = ip;

              await qr.query(`
                INSERT INTO ips_asignadas
                  (empresa_id, segmento_id, contrato_id, ip_address, tipo, activa, asignada_en)
                VALUES ($1, $2, $3, $4, 'cliente', true, NOW())
                ON CONFLICT (segmento_id, ip_address) WHERE activa = true
                DO UPDATE SET empresa_id = $1, contrato_id = $3, asignada_en = NOW()
              `, [user.empresaId, segmentoId, dto.contratoId, ip]);

              await qr.query(
                'UPDATE contratos SET ip_asignada = $1 WHERE id = $2',
                [ip, dto.contratoId],
              );

              await qr.commitTransaction();
            } catch (err) {
              await qr.rollbackTransaction();
              throw err;
            } finally {
              await qr.release();
            }

          } else {
            throw new Error(
              'El contrato no tiene IP asignada ni se proporcionó segmentoId o ipManual.',
            );
          }

          ctx.ipRegistradaEnBd = true;
          return { detalle: `IP asignada: ${ctx.ipAsignada}` };
        },
      },

      // ══════════════════════════════════════════════════════
      // PASO 3 — Registrar acceso en Mikrotik
      //   • pppoe_addresslist → PPPoE secret
      //   • amarre_ip_mac     → ARP estático
      //   • amarre_ip_mac_dhcp→ ARP estático + DHCP lease
      // ══════════════════════════════════════════════════════
      {
        num: 3,
        nombre: 'Registrar acceso en Mikrotik',
        fn: async (ctx) => {
          if (!ctx.ipAsignada) throw new Error('No hay IP asignada');

          return this.withRouterLock(ctx.contrato.router_id, async () => {
          const creds       = this.buildRouterCreds(ctx.contrato);
          const tipoControl = ctx.contrato.tipo_control as TipoControl;
          const comment     = `DATAFAST:${dto.contratoId}:${ctx.contrato.cliente_nombre}`;

          // ── PPPoE ──────────────────────────────────────────
          if (!tipoControl || tipoControl === TipoControl.PPPOE) {
            if (!ctx.usuarioPppoe) throw new Error('El contrato no tiene usuario PPPoE asignado');

            await this.pppoeSvc.crear(creds, {
              name:          ctx.usuarioPppoe,
              password:      ctx.passwordPppoePlain || '',
              profile:       ctx.contrato.ppp_profile || 'default',
              service:       'pppoe',
              remoteAddress: ctx.ipAsignada,
              comment,
              disabled:      false,
            });

            ctx.pppoeCreado = true;
            return {
              detalle: `PPPoE creado: usuario="${ctx.usuarioPppoe}" | IP: ${ctx.ipAsignada} | perfil: ${ctx.contrato.ppp_profile || 'default'}`,
            };
          }

          // ── Amarre IP/MAC (con o sin DHCP) ────────────────
          const mac = ctx.contrato.mac_address;
          if (!mac) throw new Error('El contrato no tiene dirección MAC registrada. Actualiza el contrato antes de aprovisionar.');

          // Detectar interface del router que tiene la subred del cliente
          const iface = await this.arpSvc.detectarInterface(creds, ctx.ipAsignada);
          if (!iface) {
            throw new Error(
              `No se encontró interface en el router que contenga la IP ${ctx.ipAsignada}. ` +
              `Verifica que las interfaces del router tengan IPs configuradas en el segmento correspondiente.`,
            );
          }

          await this.arpSvc.crearArpEstatico(creds, ctx.ipAsignada, mac, iface, comment);
          ctx.arpCreado = true;

          // ── + DHCP lease ────────────────────────────────────
          if (tipoControl === TipoControl.AMARRE_IP_MAC_DHCP) {
            // Detectar servidor DHCP en la misma interface, o usar el proporcionado
            let dhcpServer = dto.dhcpServer;
            if (!dhcpServer) {
              const servers = await this.firewallSvc.listarServidoresDhcp(creds);
              const match   = servers.find((s: any) => s.interface === iface);
              dhcpServer    = match?.name || servers[0]?.name;
              if (!dhcpServer) {
                throw new Error(
                  `No se encontró servidor DHCP en la interface "${iface}". ` +
                  `Configura un servidor DHCP en el router o especifica dhcpServer en la petición.`,
                );
              }
            }

            await this.firewallSvc.crearDhcpBinding(creds, {
              macAddress:  mac,
              ipAddress:   ctx.ipAsignada,
              server:      dhcpServer,
              comment,
            });
            ctx.dhcpLeaseCreado = true;

            return {
              detalle: `Amarre IP/MAC + DHCP: ${ctx.ipAsignada} ↔ ${mac} | interface: ${iface} | servidor DHCP: ${dhcpServer}`,
            };
          }

          return {
            detalle: `Amarre IP/MAC: ${ctx.ipAsignada} ↔ ${mac} | interface: ${iface}`,
          };
          }); // withRouterLock
        },
      },

      // ══════════════════════════════════════════════════════
      // PASO 4 — Configurar control de velocidad (Queue)
      // ══════════════════════════════════════════════════════
      {
        num: 4,
        nombre: 'Configurar control de velocidad',
        fn: async (ctx) => {
          if (dto.omitirQueue) {
            return { detalle: 'Paso omitido por opción omitirQueue=true' };
          }

          if (!ctx.contrato.auto_configurar_queues) {
            return { detalle: 'Router configurado para no auto-crear queues — omitido' };
          }

          return this.withRouterLock(ctx.contrato.router_id, async () => {
          const creds = this.buildRouterCreds(ctx.contrato);

          const res = await this.velocidadOrc.aplicarVelocidad({
            routerCreds:    creds,
            clienteId:      dto.clienteId,
            usuarioPppoe:   ctx.usuarioPppoe,
            ipAsignada:     ctx.ipAsignada,
            downloadMbps:   parseInt(ctx.contrato.velocidad_bajada, 10),
            uploadMbps:     parseInt(ctx.contrato.velocidad_subida, 10),
            burstDownMbps:  ctx.contrato.burst_bajada   ? parseInt(ctx.contrato.burst_bajada, 10)  : undefined,
            burstUpMbps:    ctx.contrato.burst_subida   ? parseInt(ctx.contrato.burst_subida, 10)  : undefined,
            burstTiempoSeg: ctx.contrato.burst_tiempo   ? parseInt(ctx.contrato.burst_tiempo, 10)  : 8,
            tipoQueuePlan:  ctx.contrato.tipo_queue     || 'simple_queue',
            tipoPlan:       ctx.contrato.plan_tipo      || 'residencial',
          });

          ctx.queueCreada = true;
          return {
            detalle: `Queue configurada: ${res.estrategia} | ${ctx.contrato.velocidad_bajada}/${ctx.contrato.velocidad_subida} Mbps | ${res.detalle}`,
            datos:   { estrategia: res.estrategia, reglasCreadas: res.reglasCreadas },
          };
          }); // withRouterLock
        },
      },

      // ══════════════════════════════════════════════════════
      // PASO 5 — Detectar y aprovisionar ONU en la OLT
      //
      // Advisory lock por SN: pg_advisory_xact_lock garantiza que dos
      // solicitudes concurrentes con el mismo serial no envíen comandos
      // SSH simultáneos a la OLT (OLT puede corromper la ONU si recibe
      // dos provisioning del mismo SN al mismo tiempo).
      // ══════════════════════════════════════════════════════
      {
        num: 5,
        nombre: 'Detectar y aprovisionar ONU en la OLT',
        fn: async (ctx) => {
          ctx.serialNumber = dto.serialNumber;
          const provider = this.oltFactory.get(ctx.oltMetodo!);

          if (!ctx.serialNumber) {
            const onusDisponibles = await provider.listarOnusNoAprovisionadas(ctx.oltConexion!);
            const match = onusDisponibles.find((o) => o.ponPort === dto.ponPort);
            if (!match) {
              throw new Error(
                `No se encontró ONU no aprovisionada en el puerto PON ${dto.ponPort} ` +
                `del OLT "${ctx.contrato.olt_nombre}". ` +
                `Verifica que la ONU esté conectada y encendida.`,
              );
            }
            ctx.serialNumber = match.serial;
            this.logger.log(`ONU detectada automáticamente: SN=${ctx.serialNumber}`);
          }

          // Advisory lock transaccional por SN: se libera automáticamente al
          // hacer commit/rollback. Previene aprovisionamiento doble concurrente.
          const qrSn = this.ds.createQueryRunner();
          await qrSn.connect();
          await qrSn.startTransaction();
          try {
            await qrSn.query(
              `SELECT pg_advisory_xact_lock(hashtext($1))`,
              [`onu_sn_provision_${ctx.serialNumber}`],
            );

            // Guardia de duplicado: si el SN ya está en BD y aprovisionado, abortar
            const existentes: Array<{ id: string }> = await qrSn.query(
              `SELECT id FROM onus WHERE serial_number = $1 AND deleted_at IS NULL LIMIT 1`,
              [ctx.serialNumber],
            );
            if (existentes.length > 0) {
              throw new Error(
                `El serial ${ctx.serialNumber} ya está registrado en BD (ID=${existentes[0].id}). ` +
                `Verifica que no esté aprovisionado en otro contrato.`,
              );
            }

            const partes    = dto.ponPort.split('/').map(Number);
            const onuResult = await provider.aprovisionarOnu(ctx.oltConexion!, {
              serial:       ctx.serialNumber,
              ponPort:      dto.ponPort,
              perfil:       dto.perfilSmartolt,
              vlanId:       dto.vlanId,
              vlanModo:     dto.vlanModo || 'access',
              descripcion:  `${ctx.contrato.cliente_nombre} — ${ctx.contrato.numero_contrato}`,
              frame:        0,
              ponSlot:      partes[0] ?? undefined,
              ponSubslot:   partes[1] ?? undefined,
              ponPortNum:   partes[partes.length - 1] ?? undefined,
            });

            ctx.smartoltOnuId    = onuResult.externId;
            ctx.onuAprovisionada = true;

            await qrSn.commitTransaction();
          } catch (err) {
            await qrSn.rollbackTransaction();
            throw err;
          } finally {
            await qrSn.release();
          }

          return {
            detalle: `ONU aprovisionada | método=${ctx.oltMetodo} | SN=${ctx.serialNumber} | PON=${dto.ponPort} | VLAN=${dto.vlanId} | externId=${ctx.smartoltOnuId}`,
            datos: {
              serialNumber:  ctx.serialNumber,
              smartoltOnuId: ctx.smartoltOnuId,
              ponPort:       dto.ponPort,
              vlanId:        dto.vlanId,
              metodo:        ctx.oltMetodo,
            },
          };
        },
      },

      // ══════════════════════════════════════════════════════
      // PASO 6 — Verificar ONU online en la OLT
      //
      // Paso NO bloqueante: si la verificación falla o la OLT no
      // soporta el método, se registra una advertencia y se continúa.
      // El motivo: la OLT puede tardar 30-60s en registrar la ONU
      // como "online" aunque el comando SSH ya fue exitoso.
      // El paso sirve para auditoría; el estado real se reconcilia
      // por el cron de monitoreo (OltMonitoreoService).
      // ══════════════════════════════════════════════════════
      {
        num: 6,
        nombre: 'Verificar ONU online en OLT',
        fn: async (ctx) => {
          const provider = this.oltFactory.get(ctx.oltMetodo!);
          if (typeof provider.verificarOnu !== 'function') {
            return { detalle: `Verificación no soportada para método ${ctx.oltMetodo} — omitida` };
          }

          // externId nativo: "{ip}/{slot}/{port}/{onuId}/{spId?}"
          const extParts = (ctx.smartoltOnuId ?? '').split('/');
          const slot  = parseInt(extParts[1] ?? '0', 10);
          const port  = parseInt(extParts[2] ?? '0', 10);
          const onuId = parseInt(extParts[3] ?? '1', 10);

          try {
            const verif = await provider.verificarOnu(ctx.oltConexion!, slot, port, onuId);
            const estado = verif.online ? 'ONLINE' : (verif.runState ?? 'desconocido');

            if (!verif.online) {
              this.logger.warn(
                `Verificación ONU: SN=${ctx.serialNumber} estado=${estado} ` +
                `— puede tardar hasta 60s en registrarse como online en la OLT`,
              );
            }

            return {
              detalle: `Estado OLT: ${estado} | Rx=${verif.rxPowerDbm ?? 'N/A'} dBm | Tx=${verif.txPowerDbm ?? 'N/A'} dBm`,
              datos: {
                online:       verif.online,
                runState:     verif.runState,
                rxPowerDbm:   verif.rxPowerDbm,
                txPowerDbm:   verif.txPowerDbm,
                temperatureC: verif.temperatureC,
              },
            };
          } catch (err: any) {
            // Fallo de verificación no interrumpe el flujo
            this.logger.warn(
              `Verificación ONU falló (no bloquea): SN=${ctx.serialNumber} — ${err.message}`,
            );
            return { detalle: `Verificación falló (no bloqueante): ${err.message}` };
          }
        },
      },

      // ══════════════════════════════════════════════════════
      // PASO 7 — Registrar ONU en BD y asociar al contrato
      // ══════════════════════════════════════════════════════
      {
        num: 7,
        nombre: 'Registrar ONU en base de datos y asociar al contrato',
        fn: async (ctx) => {
          // Parsear PON port
          const partes = dto.ponPort.split('/').map(Number);

          // Insertar o actualizar ONU en la BD
          const [onu] = await this.ds.query(`
            INSERT INTO onus
              (empresa_id, olt_id, serial_number, pon_port, pon_slot, pon_subslot, pon_port_num,
               perfil_smartolt, smartolt_onu_id, vlan_id, vlan_modo,
               metodo_aprovisionamiento,
               estado, aprovisionada_en, aprovisionada_por)
            VALUES
              ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::metodo_aprovisionamiento,
               'aprovisionada', NOW(), $13)
            ON CONFLICT (olt_id, pon_port, onu_id)
              WHERE deleted_at IS NULL
            DO UPDATE SET
              estado                  = 'aprovisionada',
              smartolt_onu_id         = $9,
              perfil_smartolt         = $8,
              vlan_id                 = $10,
              metodo_aprovisionamiento = $12::metodo_aprovisionamiento,
              aprovisionada_en        = NOW(),
              aprovisionada_por       = $13
            RETURNING id
          `, [
            user.empresaId, dto.oltId, ctx.serialNumber,
            dto.ponPort,
            partes[0] || null,
            partes[1] || null,
            partes[2] || null,
            dto.perfilSmartolt,
            ctx.smartoltOnuId,
            dto.vlanId,
            dto.vlanModo || 'access',
            ctx.oltMetodo ?? 'smartolt',
            user.sub,
          ]);

          ctx.onuId = onu?.id;
          ctx.onuRegistradaEnBd = true;

          // Asociar ONU al contrato
          await this.ds.query(`
            UPDATE contratos
            SET onu_id = $1, aprovisionado = true, aprovisionado_en = NOW()
            WHERE id = $2
          `, [ctx.onuId, dto.contratoId]);

          return {
            detalle: `ONU registrada: ID=${ctx.onuId} | SN=${ctx.serialNumber} | Asociada al contrato ${ctx.contrato.numero_contrato}`,
            datos:   { onuId: ctx.onuId, serialNumber: ctx.serialNumber },
          };
        },
      },

      // ══════════════════════════════════════════════════════
      // PASO 8 — Activar contrato y notificar al cliente
      // ══════════════════════════════════════════════════════
      {
        num: 8,
        nombre: 'Activar contrato y notificar al cliente',
        fn: async (ctx) => {
          const detalles: string[] = [];

          // Activar contrato + tipo_servicio + historial de forma atómica
          const qrPaso7 = this.ds.createQueryRunner();
          await qrPaso7.connect();
          await qrPaso7.startTransaction();
          try {
            await qrPaso7.query(`
              UPDATE contratos SET
                estado            = 'activo',
                aprovisionado     = true,
                fecha_estado      = COALESCE(fecha_estado, NOW()),
                fecha_instalacion = COALESCE(fecha_instalacion, NOW()),
                motivo_estado     = 'Aprovisionamiento FTTH completado'
              WHERE id = $1
            `, [dto.contratoId]);

            // Recalcular tipo_servicio derivado del cliente (wisp|ftth|mixto)
            await qrPaso7.query(
              `SELECT recalc_tipo_servicio_cliente($1)`,
              [dto.clienteId],
            );

            await qrPaso7.query(`
              INSERT INTO contratos_historial
                (contrato_id, empresa_id, estado_anterior, estado_nuevo,
                 motivo, usuario_id, automatico, created_at)
              VALUES ($1, $2, $3, 'activo',
                     'Aprovisionamiento FTTH completado', $4, false, NOW())
            `, [dto.contratoId, user.empresaId, ctx.contrato.contrato_estado, user.sub]);

            await qrPaso7.commitTransaction();
          } catch (err) {
            await qrPaso7.rollbackTransaction();
            throw err;
          } finally {
            await qrPaso7.release();
          }

          ctx.contratoActivado = true;
          detalles.push('Contrato activado');

          // Rellenar campos del resultado final
          resultado.ipAsignada   = ctx.ipAsignada;
          resultado.usuarioPppoe = ctx.usuarioPppoe;
          resultado.onuId        = ctx.onuId;
          resultado.serialNumber = ctx.serialNumber;

          // Notificación WhatsApp vía evento (desacoplado)
          const telCliente = ctx.contrato.cliente_whatsapp || ctx.contrato.cliente_telefono;

          if (dto.notificarWhatsApp && telCliente) {
            this.events.emit('notification.bienvenida', {
              telefono:        telCliente,
              clienteNombre:   ctx.contrato.cliente_nombre,
              planNombre:      ctx.contrato.plan_nombre,
              velocidadBajada: `${ctx.contrato.velocidad_bajada ?? '--'} Mbps`,
              velocidadSubida: `${ctx.contrato.velocidad_subida ?? '--'} Mbps`,
              usuarioPppoe:    ctx.usuarioPppoe,
              empresaId:       user.empresaId,
              clienteId:       dto.clienteId,
              contratoId:      dto.contratoId,
            });

            detalles.push('Evento bienvenida emitido');
          } else if (dto.notificarWhatsApp && !telCliente) {
            detalles.push('WhatsApp omitido: cliente sin número registrado');
          }

          // Emitir evento para el WebSocket gateway y otros listeners
          this.events.emit('aprovisionamiento.completado', {
            contratoId:    dto.contratoId,
            clienteId:     dto.clienteId,
            empresaId:     user.empresaId,
            usuarioPppoe:  ctx.usuarioPppoe,
            ipAsignada:    ctx.ipAsignada,
            serialNumber:  ctx.serialNumber,
            onuId:         ctx.onuId,
            planNombre:    ctx.contrato.plan_nombre,
            clienteNombre: ctx.contrato.cliente_nombre,
            tecnicoEmail:  user.email,
            timestamp:     new Date().toISOString(),
          });

          detalles.push('Evento WebSocket emitido');

          return {
            detalle: detalles.join(' | '),
            datos: {
              ipAsignada:    ctx.ipAsignada,
              usuarioPppoe:  ctx.usuarioPppoe,
              serialNumber:  ctx.serialNumber,
            },
          };
        },
      },
    ];

    // ─── Resultado accesible desde los pasos ─────────────────
    const resultado2 = resultado;

    // ─── Ejecutar pasos en secuencia ─────────────────────────
    this.logger.log(
      `[APROVISIONAMIENTO] Iniciando flujo FTTH\n` +
      `  Contrato: ${dto.contratoId}\n` +
      `  Cliente:  ${dto.clienteId}\n` +
      `  OLT:      ${dto.oltId} | PON: ${dto.ponPort}\n` +
      `  Router:   ${dto.routerId}\n` +
      `  Por:      ${user.email}`,
    );

    let pasoFallidoNum: number | null = null;

    for (const paso of pasos) {
      const inicioPaso = Date.now();

      try {
        const { detalle, datos } = await paso.fn(ctx);
        const dur = Date.now() - inicioPaso;

        resultado.pasos.push({
          paso:       paso.num,
          nombre:     paso.nombre,
          estado:     'ok',
          detalle,
          duracionMs: dur,
          datos,
        });

        this.logger.log(`✓ Paso ${paso.num}/8 [${dur}ms]: ${detalle}`);

      } catch (err) {
        const dur = Date.now() - inicioPaso;
        pasoFallidoNum = paso.num;

        resultado.pasos.push({
          paso:       paso.num,
          nombre:     paso.nombre,
          estado:     'error',
          detalle:    err.message,
          duracionMs: dur,
        });

        resultado.pasosFallidos = [paso.num];
        this.logger.error(`✗ Paso ${paso.num}/8 [${dur}ms]: ${err.message}`);

        // Marcar pasos restantes como omitidos
        for (const restante of pasos.slice(paso.num)) {
          resultado.pasos.push({
            paso:    restante.num,
            nombre:  restante.nombre,
            estado:  'omitido',
            detalle: `Omitido por fallo en paso ${paso.num}: ${err.message}`,
          });
        }

        break; // Detener ejecución
      }
    }

    // ─── Calcular duración total ──────────────────────────────
    resultado.duracionTotalMs = Date.now() - inicio;

    // ─── Rollback si hubo error ───────────────────────────────
    if (pasoFallidoNum !== null && dto.rollbackEnError !== false) {
      this.logger.warn(`Iniciando rollback por fallo en paso ${pasoFallidoNum}...`);

      await this.ejecutarRollback(
        {
          contratoId:     dto.contratoId,
          motivo:         `Rollback automático por fallo en paso ${pasoFallidoNum}`,
          eliminarSmartolt: true,
          eliminarPppoe:    true,
          liberarIp:        true,
        },
        ctx,
        user,
        resultado.pasos,
      );

      resultado.rollbackEjecutado = true;
      resultado.exitoso     = false;
      resultado.mensajeFinal =
        `❌ Aprovisionamiento fallido en paso ${pasoFallidoNum}. ` +
        `Rollback ejecutado. Ver detalle de pasos.`;

    } else if (pasoFallidoNum !== null) {
      resultado.exitoso     = false;
      resultado.mensajeFinal = `❌ Fallo en paso ${pasoFallidoNum}. Rollback omitido (rollbackEnError=false).`;

    } else {
      // ─── Todo exitoso ────────────────────────────────────
      resultado.exitoso     = true;
      resultado.mensajeFinal =
        `✅ Aprovisionamiento FTTH completado en ${resultado.duracionTotalMs}ms | ` +
        `IP: ${resultado.ipAsignada} | PPPoE: ${resultado.usuarioPppoe} | SN: ${resultado.serialNumber}`;

      this.logger.log(
        `[APROVISIONAMIENTO] ✅ COMPLETADO\n` +
        `  Contrato: ${dto.contratoId}\n` +
        `  IP:       ${resultado.ipAsignada}\n` +
        `  PPPoE:    ${resultado.usuarioPppoe}\n` +
        `  ONU SN:   ${resultado.serialNumber}\n` +
        `  Duración: ${resultado.duracionTotalMs}ms`,
      );
    }

    return resultado;
  }

  // ────────────────────────────────────────────────────────────
  // ROLLBACK — Revertir lo que ya se hizo en caso de error
  // ────────────────────────────────────────────────────────────
  async ejecutarRollback(
    dto:   RollbackAprovisionamientoDto,
    ctx?:  Ctx,
    user?: JwtPayload,
    pasos?: PasoResultadoDto[],
  ): Promise<{ revertidos: string[]; errores: string[] }> {
    const revertidos: string[] = [];
    const errores:    string[] = [];

    this.logger.log(`Rollback iniciado: contrato ${dto.contratoId} | motivo: ${dto.motivo}`);

    // Obtener datos del contrato para el rollback
    const [contrato] = await this.ds.query(`
      SELECT co.*, ro.ip_gestion AS router_ip, ro.vpn_ip,
             ro.usuario AS router_usuario,
             ro.password_cifrado AS router_pass, ro.usar_ssl, ro.puerto_api,
             ro.puerto_api_ssl, ro.version_ros, ro.timeout_conexion,
             ol.smartolt_id,
             on2.id AS onu_bd_id, on2.smartolt_onu_id, on2.serial_number
      FROM contratos co
      LEFT JOIN routers ro ON ro.id = co.router_id
      LEFT JOIN olts    ol ON ol.id = $2
      LEFT JOIN onus    on2 ON on2.id = co.onu_id
      WHERE co.id = $1
    `, [dto.contratoId]).catch(() => [null]);

    // ── 1. Eliminar provisión OLT ────────────────────────────
    if (dto.eliminarSmartolt !== false) {
      const onuExternId   = ctx?.smartoltOnuId || contrato?.smartolt_onu_id;
      const oltMetodoRollback = ctx?.oltMetodo ?? OltMetodoConexion.SMARTOLT_API;

      if (onuExternId && ctx?.oltConexion) {
        try {
          const provider = this.oltFactory.get(oltMetodoRollback);
          await provider.desaprovisionarOnu(ctx.oltConexion, onuExternId);
          revertidos.push(`OLT (${oltMetodoRollback}): provisión eliminada (ONU ${onuExternId})`);
        } catch (err) {
          errores.push(`OLT rollback: ${err.message}`);
        }
      } else if (onuExternId && contrato?.smartolt_id) {
        // Fallback: SmartOLT directo cuando no hay ctx
        try {
          await this.smartoltApi.eliminarProvision(contrato.smartolt_id, onuExternId);
          revertidos.push(`SmartOLT: provisión eliminada (ONU ${onuExternId})`);
        } catch (err) {
          errores.push(`SmartOLT: ${err.message}`);
        }
      }
    }

    // ── 2. Eliminar acceso en Mikrotik (PPPoE / ARP / DHCP) ─
    if (dto.eliminarPppoe !== false && contrato?.router_ip) {
      const rollbackCreds = {
        id:              contrato.router_id,
        ip:              contrato.vpn_ip || contrato.router_ip,
        port:            contrato.usar_ssl ? contrato.puerto_api_ssl : contrato.puerto_api,
        user:            contrato.router_usuario,
        passwordCifrado: contrato.router_pass,
        useSsl:          contrato.usar_ssl || false,
        timeoutSec:      contrato.timeout_conexion || 10,
        version:         contrato.version_ros === 'v7' ? 'v7' : 'v6' as any,
      };

      const usuarioPppoe = ctx?.usuarioPppoe || contrato?.usuario_pppoe;
      if (ctx?.pppoeCreado && usuarioPppoe) {
        try {
          await this.pppoeSvc.eliminar(rollbackCreds, usuarioPppoe);
          revertidos.push(`Mikrotik: usuario PPPoE "${usuarioPppoe}" eliminado`);
        } catch (err) {
          errores.push(`Mikrotik PPPoE: ${err.message}`);
        }
      }

      const ipAsignada = ctx?.ipAsignada || contrato?.ip_asignada;
      if (ctx?.arpCreado && ipAsignada) {
        try {
          await this.arpSvc.eliminarArpEstatico(rollbackCreds, ipAsignada);
          revertidos.push(`Mikrotik: ARP estático ${ipAsignada} eliminado`);
        } catch (err) {
          errores.push(`Mikrotik ARP: ${err.message}`);
        }
      }

      if (ctx?.dhcpLeaseCreado && ipAsignada) {
        try {
          await this.firewallSvc.eliminarDhcpBinding(rollbackCreds, contrato.mac_address || '');
          revertidos.push(`Mikrotik: DHCP lease ${ipAsignada} eliminado`);
        } catch (err) {
          errores.push(`Mikrotik DHCP: ${err.message}`);
        }
      }
    }

    // ── 3. Liberar IP del pool ───────────────────────────────
    if (dto.liberarIp !== false) {
      const ipAsignada = ctx?.ipAsignada || contrato?.ip_asignada;
      if (ipAsignada) {
        try {
          await this.ds.query(
            `UPDATE ips_asignadas SET activa = false, liberada_en = NOW()
             WHERE contrato_id = $1 AND activa = true`,
            [dto.contratoId],
          );
          await this.ds.query(
            'UPDATE contratos SET ip_asignada = NULL WHERE id = $1',
            [dto.contratoId],
          );
          revertidos.push(`IP ${ipAsignada} liberada al pool`);
        } catch (err) {
          errores.push(`IP pool: ${err.message}`);
        }
      }
    }

    // ── 4. Desasociar ONU del contrato ───────────────────────
    const onuBdId = ctx?.onuId || contrato?.onu_bd_id;
    if (onuBdId) {
      try {
        await this.ds.query(`
          UPDATE contratos SET onu_id = NULL, aprovisionado = false, aprovisionado_en = NULL
          WHERE id = $1
        `, [dto.contratoId]);

        await this.ds.query(`
          UPDATE onus SET estado = 'sin_aprovisionar', smartolt_onu_id = NULL, aprovisionada_en = NULL
          WHERE id = $1
        `, [onuBdId]);

        // Recalcular tipo_servicio de forma atómica con FOR UPDATE para evitar
        // race conditions entre rollbacks concurrentes del mismo cliente
        const qrTipo = this.ds.createQueryRunner();
        await qrTipo.connect();
        await qrTipo.startTransaction();
        try {
          const rows: { cliente_id: string }[] = await qrTipo.query(
            `SELECT cliente_id FROM contratos WHERE id = $1`,
            [dto.contratoId],
          );
          const clienteIdRollback = rows[0]?.cliente_id;
          if (clienteIdRollback) {
            await qrTipo.query(
              `SELECT recalc_tipo_servicio_cliente($1)`,
              [clienteIdRollback],
            );
          }
          await qrTipo.commitTransaction();
        } catch (err) {
          await qrTipo.rollbackTransaction();
          errores.push(`tipo_servicio recalc: ${err.message}`);
        } finally {
          await qrTipo.release();
        }

        revertidos.push(`ONU ${onuBdId} desasociada y marcada sin_aprovisionar`);
      } catch (err) {
        errores.push(`ONU BD: ${err.message}`);
      }
    }

    // ── 5. Revertir estado del contrato ──────────────────────
    try {
      await this.ds.query(`
        UPDATE contratos SET
          estado       = 'pendiente_activacion',
          fecha_estado = NOW(),
          motivo_estado = $1,
          aprovisionado = false
        WHERE id = $2 AND estado = 'activo'
      `, [dto.motivo || 'Rollback de aprovisionamiento', dto.contratoId]);
      revertidos.push('Contrato revertido a pendiente_activacion');
    } catch (err) {
      errores.push(`Estado contrato: ${err.message}`);
    }

    this.logger.log(
      `Rollback completado: ${revertidos.length} acciones revertidas, ${errores.length} errores\n` +
      `  Revertidos: ${revertidos.join(' | ')}\n` +
      `  Errores:    ${errores.join(' | ') || 'ninguno'}`,
    );

    return { revertidos, errores };
  }

  // ── Helper: construir credenciales de conexión del router ──
  private buildRouterCreds(row: any) {
    return {
      id:              row.router_id,
      ip:              row.router_ip,
      port:            row.usar_ssl ? row.puerto_api_ssl : row.puerto_api,
      user:            row.router_usuario,
      passwordCifrado: row.router_pass,
      useSsl:          row.usar_ssl || false,
      timeoutSec:      row.timeout_conexion || 10,
      version:         (row.version_ros === 'v7' ? 'v7' : 'v6') as 'v6' | 'v7',
    };
  }
}
