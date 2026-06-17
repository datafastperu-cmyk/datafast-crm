import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource }   from '@nestjs/typeorm';
import { DataSource }         from 'typeorm';
import { EventEmitter2 }      from '@nestjs/event-emitter';

import { PppoeService }       from '../mikrotik/services/pppoe.service';
import { QueueService }       from '../mikrotik/services/queue.service';
import { ArpService }         from '../mikrotik/services/arp.service';
import { FirewallService }    from '../mikrotik/services/firewall.service';
import { VelocidadOrquestador } from '../mikrotik/services/velocidad/velocidad-orquestador.service';
import { TipoControl }        from '../mikrotik/entities/router.entity';
import { SmartoltApiService } from '../smartolt/smartolt-api.service';
import { OltMetodoConexion }  from '../olt-nativo/entities/olt-dispositivo.entity';
import { OltProviderFactory } from '../olt-provider/olt-provider.factory';
import { OltConexion }        from '../olt-provider/interfaces/olt-provider.interface';
import { JwtPayload }         from '../../common/decorators/current-user.decorator';
import { decrypt }            from '../../common/utils/encryption.util';
import { getNextAvailableIp } from '../../common/utils/ip.util';
import { TipoServicioContrato } from '../../common/constants/service-types';

import {
  MigrarWispFtthDto,
  MigracionResultadoDto,
  PasoMigracionDto,
} from './migracion.dto';

// ─── Contexto compartido entre pasos ─────────────────────────
interface MigrCtx {
  contrato?:            any;
  router?:              any;
  routerFtth?:          any;
  ipWisp?:              string;
  ipFtth?:              string;
  usuarioPppoe?:        string;
  passwordPppoePlain?:  string;
  serialNumber?:        string;
  onuExternId?:         string;
  onuId?:               string;
  oltConexion?:         OltConexion;
  oltMetodo?:           OltMetodoConexion;
  // Rollback flags
  marcadoEnMigracion:   boolean;
  ipWispLiberada:       boolean;
  accesWispEliminado:   boolean;
  ipFtthAsignada:       boolean;
  onuAprovisionada:     boolean;
  onuRegistradaEnBd:    boolean;
  accesoFtthCreado:     boolean;
  queueFtthCreada:      boolean;
}

// ─────────────────────────────────────────────────────────────
// MigracionService — Flujo transaccional WISP → FTTH
// 10 pasos con rollback granular por contexto
// ─────────────────────────────────────────────────────────────
@Injectable()
export class MigracionService {
  private readonly logger = new Logger(MigracionService.name);

  // Semáforo por router para evitar saturación de sesiones RouterOS
  private readonly routerSem = new Map<string, Promise<void>>();

  constructor(
    private readonly pppoeSvc:     PppoeService,
    private readonly queueSvc:     QueueService,
    private readonly arpSvc:       ArpService,
    private readonly firewallSvc:  FirewallService,
    private readonly velocidadOrc: VelocidadOrquestador,
    private readonly smartoltApi:  SmartoltApiService,
    private readonly oltFactory:   OltProviderFactory,
    private readonly events:       EventEmitter2,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  private async withRouterLock<T>(routerId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.routerSem.get(routerId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((res) => { release = res; });
    this.routerSem.set(routerId, next);
    try { await prev; return await fn(); }
    finally { release(); }
  }

  // ────────────────────────────────────────────────────────────
  // PUNTO DE ENTRADA
  // ────────────────────────────────────────────────────────────
  async migrarWispAFtth(
    dto:  MigrarWispFtthDto,
    user: JwtPayload,
  ): Promise<MigracionResultadoDto> {
    const inicio = Date.now();

    const resultado: MigracionResultadoDto = {
      pasos:          [],
      exitoso:        false,
      contratoId:     dto.contratoId,
      mensajeFinal:   '',
      rollbackEjecutado: false,
      pasosFallidos:  [],
    };

    const ctx: MigrCtx = {
      marcadoEnMigracion:  false,
      ipWispLiberada:      false,
      accesWispEliminado:  false,
      ipFtthAsignada:      false,
      onuAprovisionada:    false,
      onuRegistradaEnBd:   false,
      accesoFtthCreado:    false,
      queueFtthCreada:     false,
    };

    const pasos: Array<{
      num:    number;
      nombre: string;
      fn:     (ctx: MigrCtx) => Promise<{ detalle: string; datos?: Record<string, any> }>;
    }> = [

      // ══════════════════════════════════════════════════════
      // PASO 1 — Validar contrato WISP y cargar datos
      // ══════════════════════════════════════════════════════
      {
        num: 1,
        nombre: 'Validar contrato WISP y cargar recursos',
        fn: async (ctx) => {
          const rows = await this.ds.query(`
            SELECT
              co.id, co.numero_contrato, co.estado, co.aprovisionado, co.en_migracion,
              co.tipo_servicio, co.ip_asignada, co.segmento_id,
              co.usuario_pppoe, co.password_pppoe, co.mac_address,
              co.onu_id, co.router_id, co.plan_id,
              cl.id               AS cliente_id,
              cl.nombre_completo  AS cliente_nombre,
              cl.whatsapp         AS cliente_whatsapp,
              cl.telefono         AS cliente_telefono,
              pl.nombre           AS plan_nombre,
              pl.velocidad_bajada, pl.velocidad_subida,
              pl.burst_bajada, pl.burst_subida, pl.burst_tiempo,
              pl.tipo_queue, pl.ppp_profile, pl.tipo AS plan_tipo,
              ro.id               AS router_wisp_id,
              ro.ip_gestion       AS router_wisp_ip,
              ro.vpn_ip           AS router_wisp_vpn_ip,
              ro.version_ros      AS router_wisp_version,
              ro.usuario          AS router_wisp_usuario,
              ro.password_cifrado AS router_wisp_pass,
              ro.usar_ssl         AS router_wisp_ssl,
              ro.puerto_api       AS router_wisp_puerto,
              ro.puerto_api_ssl   AS router_wisp_puerto_ssl,
              ro.timeout_conexion AS router_wisp_timeout,
              ro.auto_configurar_queues,
              ro.tipo_control,
              ol.id               AS olt_id,
              ol.smartolt_id,
              ol.nombre           AS olt_nombre
            FROM contratos co
            JOIN clientes   cl ON cl.id = co.cliente_id
            JOIN planes     pl ON pl.id = co.plan_id
            LEFT JOIN routers ro ON ro.id = co.router_id
            LEFT JOIN olts    ol ON ol.id = $2
            WHERE co.id = $1 AND co.empresa_id = $3 AND co.deleted_at IS NULL
          `, [dto.contratoId, dto.oltId, user.empresaId]);

          if (!rows.length) {
            throw new Error(`Contrato ${dto.contratoId} no encontrado`);
          }
          const row = rows[0];

          if (row.tipo_servicio !== TipoServicioContrato.WISP) {
            throw new Error(
              `El contrato ${row.numero_contrato} ya es tipo "${row.tipo_servicio}". ` +
              `Solo se pueden migrar contratos WISP.`,
            );
          }
          if (row.estado !== 'activo') {
            throw new Error(
              `El contrato debe estar ACTIVO para migrar. Estado actual: "${row.estado}"`,
            );
          }
          if (row.en_migracion) {
            throw new Error(
              `El contrato ${row.numero_contrato} ya tiene una migración en curso. ` +
              `Espera a que finalice o cancela la migración anterior.`,
            );
          }

          // Cargar router FTTH
          const [routerFtth] = await this.ds.query(`
            SELECT id, ip_gestion, vpn_ip, version_ros, usuario, password_cifrado,
                   usar_ssl, puerto_api, puerto_api_ssl, timeout_conexion,
                   auto_configurar_queues, tipo_control
            FROM routers
            WHERE id = $1 AND empresa_id = $2 AND deleted_at IS NULL
          `, [dto.routerFtthId, user.empresaId]);
          if (!routerFtth) {
            throw new Error(`Router FTTH ${dto.routerFtthId} no encontrado`);
          }

          // Cargar OltDispositivo si se proporcionó (nativo SSH)
          let oltMetodo = OltMetodoConexion.SMARTOLT_API;
          let oltConexion: OltConexion = {
            externId: row.smartolt_id || row.olt_id,
            marca: 'huawei',
          };

          if (dto.oltDispositivoId) {
            const [oltDisp] = await this.ds.query(
              `SELECT id, metodo_conexion, ip_gestion, puerto, usuario_anclado,
                      contrasena_cifrada, marca::text AS marca
               FROM olt_dispositivos
               WHERE id = $1 AND empresa_id = $2 AND activo = true`,
              [dto.oltDispositivoId, user.empresaId],
            );
            if (!oltDisp) {
              throw new Error(`OltDispositivo ${dto.oltDispositivoId} no encontrado o inactivo`);
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
              `El OLT "${row.olt_nombre}" no tiene SmartOLT ID. ` +
              `Proporciona oltDispositivoId para SSH nativo.`,
            );
          }

          ctx.contrato   = row;
          ctx.routerFtth = routerFtth;
          ctx.oltConexion = oltConexion;
          ctx.oltMetodo   = oltMetodo;
          ctx.ipWisp      = row.ip_asignada;

          try { ctx.passwordPppoePlain = row.password_pppoe ? decrypt(row.password_pppoe) : ''; }
          catch { ctx.passwordPppoePlain = row.password_pppoe || ''; }
          ctx.usuarioPppoe = row.usuario_pppoe;

          return {
            detalle: `✓ Contrato ${row.numero_contrato} | Cliente: ${row.cliente_nombre} | Plan: ${row.plan_nombre} | OLT método: ${oltMetodo}`,
            datos: { contratoId: dto.contratoId, oltMetodo },
          };
        },
      },

      // ══════════════════════════════════════════════════════
      // PASO 2 — Marcar contrato en migración (advisory lock)
      // ══════════════════════════════════════════════════════
      {
        num: 2,
        nombre: 'Marcar contrato en proceso de migración',
        fn: async (ctx) => {
          const qr = this.ds.createQueryRunner();
          await qr.connect();
          await qr.startTransaction();
          try {
            // Lock por contrato — evita doble migración concurrente
            await qr.query(
              `SELECT pg_advisory_xact_lock(hashtext('migracion_' || $1))`,
              [dto.contratoId],
            );
            // Re-verificar que no haya cambiado desde el paso 1
            const [check] = await qr.query(
              `SELECT en_migracion FROM contratos WHERE id = $1 FOR UPDATE`,
              [dto.contratoId],
            );
            if (check?.en_migracion) {
              throw new Error('Otra migración fue iniciada concurrentemente. Reintenta en unos segundos.');
            }
            await qr.query(`
              UPDATE contratos SET
                en_migracion          = true,
                migracion_iniciada_en = NOW()
              WHERE id = $1
            `, [dto.contratoId]);
            await qr.commitTransaction();
          } catch (err) {
            await qr.rollbackTransaction();
            throw err;
          } finally {
            await qr.release();
          }
          ctx.marcadoEnMigracion = true;
          return { detalle: 'Contrato bloqueado para migración' };
        },
      },

      // ══════════════════════════════════════════════════════
      // PASO 3 — Eliminar acceso WISP en MikroTik
      // ══════════════════════════════════════════════════════
      {
        num: 3,
        nombre: 'Eliminar acceso WISP en MikroTik',
        fn: async (ctx) => {
          if (!ctx.contrato.router_wisp_id) {
            return { detalle: 'Contrato WISP sin router asignado — paso omitido' };
          }

          return this.withRouterLock(ctx.contrato.router_wisp_id, async () => {
            const creds = this.buildCreds(ctx.contrato, 'wisp');
            const detalle: string[] = [];
            const tipoControl = ctx.contrato.tipo_control as TipoControl;

            if (!tipoControl || tipoControl === TipoControl.PPPOE) {
              if (ctx.usuarioPppoe) {
                try {
                  await this.pppoeSvc.eliminar(creds, ctx.usuarioPppoe);
                  detalle.push(`PPPoE "${ctx.usuarioPppoe}" eliminado`);
                } catch (e) {
                  this.logger.warn(`PPPoE eliminar: ${e.message}`);
                }
              }
            } else if (ctx.ipWisp) {
              try {
                await this.arpSvc.eliminarArpEstatico(creds, ctx.ipWisp);
                detalle.push(`ARP estático ${ctx.ipWisp} eliminado`);
              } catch (e) {
                this.logger.warn(`ARP eliminar: ${e.message}`);
              }
              if (tipoControl === TipoControl.AMARRE_IP_MAC_DHCP && ctx.contrato.mac_address) {
                try {
                  await this.firewallSvc.eliminarDhcpBinding(creds, ctx.contrato.mac_address);
                  detalle.push(`DHCP lease ${ctx.ipWisp} eliminado`);
                } catch (e) {
                  this.logger.warn(`DHCP eliminar: ${e.message}`);
                }
              }
            }

            ctx.accesWispEliminado = true;
            return { detalle: detalle.join(' | ') || 'MikroTik WISP limpiado' };
          });
        },
      },

      // ══════════════════════════════════════════════════════
      // PASO 4 — Liberar IP WISP del pool
      // ══════════════════════════════════════════════════════
      {
        num: 4,
        nombre: 'Liberar IP WISP del pool',
        fn: async (ctx) => {
          if (!ctx.ipWisp) {
            return { detalle: 'Contrato sin IP asignada — paso omitido' };
          }
          await this.ds.query(`
            UPDATE ips_asignadas SET activa = false, liberada_en = NOW()
            WHERE contrato_id = $1 AND activa = true
          `, [dto.contratoId]);
          await this.ds.query(
            `UPDATE contratos SET ip_asignada = NULL WHERE id = $1`,
            [dto.contratoId],
          );
          ctx.ipWispLiberada = true;
          return { detalle: `IP WISP ${ctx.ipWisp} liberada al pool` };
        },
      },

      // ══════════════════════════════════════════════════════
      // PASO 5 — Asignar IP del pool FTTH (advisory lock)
      // ══════════════════════════════════════════════════════
      {
        num: 5,
        nombre: 'Asignar IP del pool FTTH',
        fn: async (ctx) => {
          if (dto.ipManual) {
            const [ocupada] = await this.ds.query(
              `SELECT id FROM ips_asignadas WHERE ip_address = $1 AND activa = true AND empresa_id = $2`,
              [dto.ipManual, user.empresaId],
            );
            if (ocupada) throw new Error(`La IP ${dto.ipManual} ya está asignada a otro contrato`);
            ctx.ipFtth = dto.ipManual;
            await this.persistirIp(user.empresaId, dto.segmentoFtthId, dto.contratoId, ctx.ipFtth);

          } else {
            const qr = this.ds.createQueryRunner();
            await qr.connect();
            await qr.startTransaction();
            try {
              await qr.query(
                `SELECT pg_advisory_xact_lock(hashtext('ip_pool_' || $1))`,
                [dto.segmentoFtthId],
              );
              const [seg] = await qr.query(
                `SELECT red_cidr, gateway, ips_reservadas, tipo_servicio
                 FROM segmentos_ipv4
                 WHERE id = $1 AND empresa_id = $2 AND activo = true`,
                [dto.segmentoFtthId, user.empresaId],
              );
              if (!seg) throw new Error(`Segmento FTTH ${dto.segmentoFtthId} no encontrado o inactivo`);
              if (seg.tipo_servicio !== TipoServicioContrato.FTTH && seg.tipo_servicio !== 'dedicado') {
                throw new Error(
                  `El segmento "${seg.red_cidr}" es de tipo "${seg.tipo_servicio}", no FTTH. ` +
                  `Los pools WISP y FTTH no se comparten.`,
                );
              }
              const enUso     = await qr.query(
                `SELECT ip_address FROM ips_asignadas WHERE segmento_id = $1 AND activa = true`,
                [dto.segmentoFtthId],
              );
              const usadas    = enUso.map((r: any) => r.ip_address);
              const reservadas = [seg.gateway, ...(seg.ips_reservadas || [])].filter(Boolean);
              const ip        = getNextAvailableIp(seg.red_cidr, usadas, reservadas);
              if (!ip) {
                throw new Error(`Pool FTTH exhausto en segmento ${seg.red_cidr}. Usadas: ${usadas.length}.`);
              }
              ctx.ipFtth = ip;
              await qr.query(`
                INSERT INTO ips_asignadas
                  (empresa_id, segmento_id, contrato_id, ip_address, tipo, activa, asignada_en)
                VALUES ($1, $2, $3, $4, 'cliente', true, NOW())
                ON CONFLICT (segmento_id, ip_address) WHERE activa = true
                DO UPDATE SET empresa_id = $1, contrato_id = $3, asignada_en = NOW()
              `, [user.empresaId, dto.segmentoFtthId, dto.contratoId, ip]);
              await qr.query(
                `UPDATE contratos SET ip_asignada = $1 WHERE id = $2`,
                [ip, dto.contratoId],
              );
              await qr.commitTransaction();
            } catch (err) {
              await qr.rollbackTransaction();
              throw err;
            } finally {
              await qr.release();
            }
          }
          ctx.ipFtthAsignada = true;
          return { detalle: `IP FTTH asignada: ${ctx.ipFtth}` };
        },
      },

      // ══════════════════════════════════════════════════════
      // PASO 6 — Provisionar ONU en OLT
      // ══════════════════════════════════════════════════════
      {
        num: 6,
        nombre: 'Provisionar ONU en OLT',
        fn: async (ctx) => {
          ctx.serialNumber = dto.serialNumber;
          const provider = this.oltFactory.get(ctx.oltMetodo!);

          if (!ctx.serialNumber) {
            const onusDisponibles = await provider.listarOnusNoAprovisionadas(ctx.oltConexion!);
            const match = onusDisponibles.find((o) => o.ponPort === dto.ponPort);
            if (!match) {
              throw new Error(
                `No se encontró ONU no aprovisionada en el puerto PON ${dto.ponPort}. ` +
                `Verifica que la ONU esté conectada y encendida.`,
              );
            }
            ctx.serialNumber = match.serial;
            this.logger.log(`ONU detectada automáticamente: SN=${ctx.serialNumber}`);
          }

          const partes    = dto.ponPort.split('/').map(Number);
          const onuResult = await provider.aprovisionarOnu(ctx.oltConexion!, {
            serial:       ctx.serialNumber,
            ponPort:      dto.ponPort,
            perfil:       dto.perfilOlt,
            vlanId:       dto.vlanId,
            vlanModo:     dto.vlanModo || 'access',
            descripcion:  `${ctx.contrato.cliente_nombre} — ${ctx.contrato.numero_contrato} (MIGRADO)`,
            frame:        0,
            ponSlot:      partes[0] ?? undefined,
            ponSubslot:   partes[1] ?? undefined,
            ponPortNum:   partes[partes.length - 1] ?? undefined,
          });

          ctx.onuExternId      = onuResult.externId;
          ctx.onuAprovisionada = true;

          return {
            detalle: `ONU aprovisionada | método=${ctx.oltMetodo} | SN=${ctx.serialNumber} | externId=${onuResult.externId}`,
            datos: { serialNumber: ctx.serialNumber, externId: onuResult.externId, metodo: ctx.oltMetodo },
          };
        },
      },

      // ══════════════════════════════════════════════════════
      // PASO 7 — Registrar ONU en BD y asociar al contrato
      // ══════════════════════════════════════════════════════
      {
        num: 7,
        nombre: 'Registrar ONU en base de datos',
        fn: async (ctx) => {
          const partes = dto.ponPort.split('/').map(Number);
          const [onu] = await this.ds.query(`
            INSERT INTO onus
              (empresa_id, olt_id, serial_number, pon_port, pon_slot, pon_subslot, pon_port_num,
               perfil_smartolt, smartolt_onu_id, vlan_id, vlan_modo, metodo_aprovisionamiento,
               estado, aprovisionada_en, aprovisionada_por)
            VALUES
              ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::metodo_aprovisionamiento,
               'aprovisionada', NOW(), $13)
            ON CONFLICT (olt_id, pon_port, onu_id) WHERE deleted_at IS NULL
            DO UPDATE SET
              estado                   = 'aprovisionada',
              smartolt_onu_id          = $9,
              perfil_smartolt          = $8,
              vlan_id                  = $10,
              metodo_aprovisionamiento = $12::metodo_aprovisionamiento,
              aprovisionada_en         = NOW(),
              aprovisionada_por        = $13
            RETURNING id
          `, [
            user.empresaId, dto.oltId, ctx.serialNumber,
            dto.ponPort,
            partes[0] || null,
            partes[1] || null,
            partes[partes.length - 1] || null,
            dto.perfilOlt,
            ctx.onuExternId,
            dto.vlanId,
            dto.vlanModo || 'access',
            ctx.oltMetodo ?? 'smartolt',
            user.sub,
          ]);

          ctx.onuId = onu?.id;
          ctx.onuRegistradaEnBd = true;

          await this.ds.query(`
            UPDATE contratos SET onu_id = $1, aprovisionado = true, aprovisionado_en = NOW()
            WHERE id = $2
          `, [ctx.onuId, dto.contratoId]);

          return {
            detalle: `ONU registrada: ID=${ctx.onuId} | SN=${ctx.serialNumber}`,
            datos: { onuId: ctx.onuId },
          };
        },
      },

      // ══════════════════════════════════════════════════════
      // PASO 8 — Configurar acceso FTTH en MikroTik
      // ══════════════════════════════════════════════════════
      {
        num: 8,
        nombre: 'Configurar acceso FTTH en MikroTik',
        fn: async (ctx) => {
          return this.withRouterLock(dto.routerFtthId, async () => {
            const creds       = this.buildCreds(ctx.routerFtth, 'ftth');
            const tipoControl = ctx.routerFtth.tipo_control as TipoControl;
            const comment     = `DATAFAST:${dto.contratoId}:${ctx.contrato.cliente_nombre}:FTTH`;

            if (!tipoControl || tipoControl === TipoControl.PPPOE) {
              if (!ctx.usuarioPppoe) throw new Error('Sin usuario PPPoE en contrato');
              await this.pppoeSvc.crear(creds, {
                name:          ctx.usuarioPppoe,
                password:      ctx.passwordPppoePlain || '',
                profile:       ctx.contrato.ppp_profile || 'default',
                service:       'pppoe',
                remoteAddress: ctx.ipFtth!,
                comment,
                disabled:      false,
              });
              ctx.accesoFtthCreado = true;
              return { detalle: `PPPoE FTTH creado: "${ctx.usuarioPppoe}" IP=${ctx.ipFtth}` };
            }

            // Amarre IP/MAC
            const mac = ctx.contrato.mac_address;
            if (!mac) throw new Error('Sin MAC en contrato para amarre IP/MAC FTTH');

            const iface = await this.arpSvc.detectarInterface(creds, ctx.ipFtth!);
            if (!iface) {
              throw new Error(`No se encontró interface para IP ${ctx.ipFtth} en router FTTH`);
            }
            await this.arpSvc.crearArpEstatico(creds, ctx.ipFtth!, mac, iface, comment);

            if (tipoControl === TipoControl.AMARRE_IP_MAC_DHCP) {
              let dhcpServer = dto.dhcpServer;
              if (!dhcpServer) {
                const servers = await this.firewallSvc.listarServidoresDhcp(creds);
                const match   = servers.find((s: any) => s.interface === iface);
                dhcpServer    = match?.name || servers[0]?.name;
                if (!dhcpServer) throw new Error(`Sin servidor DHCP en interface "${iface}" del router FTTH`);
              }
              await this.firewallSvc.crearDhcpBinding(creds, { macAddress: mac, ipAddress: ctx.ipFtth!, server: dhcpServer, comment });
              ctx.accesoFtthCreado = true;
              return { detalle: `Amarre IP/MAC+DHCP FTTH: ${ctx.ipFtth} ↔ ${mac} | iface=${iface}` };
            }

            ctx.accesoFtthCreado = true;
            return { detalle: `Amarre IP/MAC FTTH: ${ctx.ipFtth} ↔ ${mac} | iface=${iface}` };
          });
        },
      },

      // ══════════════════════════════════════════════════════
      // PASO 9 — Configurar velocidad (Queue) FTTH
      // ══════════════════════════════════════════════════════
      {
        num: 9,
        nombre: 'Configurar control de velocidad FTTH',
        fn: async (ctx) => {
          if (dto.omitirQueue || !ctx.routerFtth.auto_configurar_queues) {
            return { detalle: 'Queue omitida' };
          }
          return this.withRouterLock(dto.routerFtthId, async () => {
            const creds = this.buildCreds(ctx.routerFtth, 'ftth');
            const res   = await this.velocidadOrc.aplicarVelocidad({
              routerCreds:    creds,
              clienteId:      dto.clienteId,
              usuarioPppoe:   ctx.usuarioPppoe,
              ipAsignada:     ctx.ipFtth,
              downloadMbps:   parseInt(ctx.contrato.velocidad_bajada, 10),
              uploadMbps:     parseInt(ctx.contrato.velocidad_subida, 10),
              burstDownMbps:  ctx.contrato.burst_bajada   ? parseInt(ctx.contrato.burst_bajada, 10)  : undefined,
              burstUpMbps:    ctx.contrato.burst_subida   ? parseInt(ctx.contrato.burst_subida, 10)  : undefined,
              burstTiempoSeg: ctx.contrato.burst_tiempo   ? parseInt(ctx.contrato.burst_tiempo, 10)  : 8,
              tipoQueuePlan:  ctx.contrato.tipo_queue     || 'simple_queue',
              tipoPlan:       ctx.contrato.plan_tipo      || 'residencial',
            });
            ctx.queueFtthCreada = true;
            return { detalle: `Queue FTTH: ${res.estrategia} | ${ctx.contrato.velocidad_bajada}/${ctx.contrato.velocidad_subida} Mbps` };
          });
        },
      },

      // ══════════════════════════════════════════════════════
      // PASO 10 — Finalizar migración
      // ══════════════════════════════════════════════════════
      {
        num: 10,
        nombre: 'Finalizar migración y actualizar contrato',
        fn: async (ctx) => {
          const qr = this.ds.createQueryRunner();
          await qr.connect();
          await qr.startTransaction();
          try {
            await qr.query(`
              UPDATE contratos SET
                tipo_servicio         = $1::tipo_servicio,
                router_id             = $2,
                en_migracion          = false,
                migracion_iniciada_en = NULL,
                motivo_estado         = 'Migración WISP→FTTH completada'
              WHERE id = $3
            `, [TipoServicioContrato.FTTH, dto.routerFtthId, dto.contratoId]);

            await qr.query(
              `SELECT recalc_tipo_servicio_cliente($1)`,
              [dto.clienteId],
            );

            await qr.query(`
              INSERT INTO contratos_historial
                (contrato_id, empresa_id, estado_anterior, estado_nuevo,
                 motivo, usuario_id, automatico, created_at)
              VALUES ($1, $2, $3, $3, 'Migración WISP→FTTH completada', $4, false, NOW())
            `, [dto.contratoId, user.empresaId, 'activo', user.sub]);

            await qr.commitTransaction();
          } catch (err) {
            await qr.rollbackTransaction();
            throw err;
          } finally {
            await qr.release();
          }

          resultado.ipFtth       = ctx.ipFtth;
          resultado.onuId        = ctx.onuId;
          resultado.serialNumber = ctx.serialNumber;

          // Notificar (desacoplado)
          const tel = ctx.contrato.cliente_whatsapp || ctx.contrato.cliente_telefono;
          if (dto.notificarWhatsApp && tel) {
            this.events.emit('notification.migracion_ftth', {
              telefono:      tel,
              clienteNombre: ctx.contrato.cliente_nombre,
              ipFtth:        ctx.ipFtth,
              empresaId:     user.empresaId,
              clienteId:     dto.clienteId,
            });
          }

          this.events.emit('migracion.completada', {
            contratoId: dto.contratoId,
            clienteId:  dto.clienteId,
            empresaId:  user.empresaId,
            ipFtth:     ctx.ipFtth,
            onuId:      ctx.onuId,
            timestamp:  new Date().toISOString(),
          });

          return {
            detalle: `Migración WISP→FTTH completada | IP: ${ctx.ipFtth} | ONU: ${ctx.serialNumber}`,
            datos: { ipFtth: ctx.ipFtth, onuId: ctx.onuId },
          };
        },
      },
    ];

    // ─── Ejecutar pasos en secuencia ─────────────────────────
    this.logger.log(
      `[MIGRACIÓN] Iniciando WISP→FTTH | contrato=${dto.contratoId} | por=${user.email}`,
    );

    let pasoFallidoNum: number | null = null;

    for (const paso of pasos) {
      const ini = Date.now();
      try {
        const { detalle, datos } = await paso.fn(ctx);
        resultado.pasos.push({
          paso: paso.num, nombre: paso.nombre, estado: 'ok',
          detalle, duracionMs: Date.now() - ini, datos,
        });
        this.logger.log(`✓ Paso ${paso.num}/10 [${Date.now() - ini}ms]: ${detalle}`);
      } catch (err) {
        pasoFallidoNum = paso.num;
        resultado.pasos.push({
          paso: paso.num, nombre: paso.nombre, estado: 'error',
          detalle: err.message, duracionMs: Date.now() - ini,
        });
        resultado.pasosFallidos = [paso.num];
        this.logger.error(`✗ Paso ${paso.num}/10: ${err.message}`);
        for (const restante of pasos.slice(paso.num)) {
          resultado.pasos.push({
            paso: restante.num, nombre: restante.nombre, estado: 'omitido',
            detalle: `Omitido por fallo en paso ${paso.num}`,
          });
        }
        break;
      }
    }

    resultado.duracionTotalMs = Date.now() - inicio;

    if (pasoFallidoNum !== null && dto.rollbackEnError !== false) {
      await this.ejecutarRollback(ctx, user, resultado.pasos);
      resultado.rollbackEjecutado = true;
      resultado.exitoso     = false;
      resultado.mensajeFinal = `❌ Migración fallida en paso ${pasoFallidoNum}. Rollback ejecutado.`;
    } else if (pasoFallidoNum !== null) {
      resultado.exitoso     = false;
      resultado.mensajeFinal = `❌ Migración fallida en paso ${pasoFallidoNum}. Rollback omitido.`;
    } else {
      resultado.exitoso     = true;
      resultado.mensajeFinal =
        `✅ Migración WISP→FTTH completada en ${resultado.duracionTotalMs}ms | ` +
        `IP FTTH: ${resultado.ipFtth} | SN: ${resultado.serialNumber}`;
      this.logger.log(`[MIGRACIÓN] ✅ COMPLETADA | contrato=${dto.contratoId} | IP=${resultado.ipFtth}`);
    }

    return resultado;
  }

  // ────────────────────────────────────────────────────────────
  // ROLLBACK
  // ────────────────────────────────────────────────────────────
  private async ejecutarRollback(
    ctx:   MigrCtx,
    user:  JwtPayload,
    _pasos: PasoMigracionDto[],
  ): Promise<void> {
    this.logger.warn(`[MIGRACIÓN] Iniciando rollback...`);
    const errs: string[] = [];

    // Desaprovisionar ONU
    if (ctx.onuAprovisionada && ctx.oltConexion && ctx.onuExternId) {
      try {
        const provider = this.oltFactory.get(ctx.oltMetodo!);
        await provider.desaprovisionarOnu(ctx.oltConexion, ctx.onuExternId);
      } catch (e) { errs.push(`ONU rollback: ${e.message}`); }
    }

    // Desasociar ONU de BD
    if (ctx.onuId) {
      try {
        await this.ds.query(`
          UPDATE contratos SET onu_id = NULL, aprovisionado = false, aprovisionado_en = NULL WHERE id = $1
        `, [ctx.contrato?.id]);
        await this.ds.query(`
          UPDATE onus SET estado = 'sin_aprovisionar', smartolt_onu_id = NULL WHERE id = $1
        `, [ctx.onuId]);
      } catch (e) { errs.push(`ONU BD rollback: ${e.message}`); }
    }

    // Liberar IP FTTH
    if (ctx.ipFtthAsignada && ctx.ipFtth) {
      try {
        await this.ds.query(
          `UPDATE ips_asignadas SET activa = false, liberada_en = NOW() WHERE contrato_id = $1 AND ip_address = $2`,
          [ctx.contrato?.id, ctx.ipFtth],
        );
        await this.ds.query(`UPDATE contratos SET ip_asignada = NULL WHERE id = $1`, [ctx.contrato?.id]);
      } catch (e) { errs.push(`IP FTTH rollback: ${e.message}`); }
    }

    // Restaurar IP WISP si la liberamos pero la migración falló
    if (ctx.ipWispLiberada && ctx.ipWisp && ctx.contrato?.segmento_id) {
      try {
        await this.ds.query(`
          INSERT INTO ips_asignadas (empresa_id, segmento_id, contrato_id, ip_address, tipo, activa, asignada_en)
          VALUES ($1, $2, $3, $4, 'cliente', true, NOW())
          ON CONFLICT DO NOTHING
        `, [user.empresaId, ctx.contrato.segmento_id, ctx.contrato.id, ctx.ipWisp]);
        await this.ds.query(`UPDATE contratos SET ip_asignada = $1 WHERE id = $2`, [ctx.ipWisp, ctx.contrato.id]);
      } catch (e) { errs.push(`IP WISP restore: ${e.message}`); }
    }

    // Quitar flag en_migracion
    if (ctx.marcadoEnMigracion) {
      try {
        await this.ds.query(`
          UPDATE contratos SET en_migracion = false, migracion_iniciada_en = NULL WHERE id = $1
        `, [ctx.contrato?.id]);
      } catch (e) { errs.push(`en_migracion clear: ${e.message}`); }
    }

    if (errs.length) {
      this.logger.error(`[MIGRACIÓN] Errores en rollback: ${errs.join(' | ')}`);
    } else {
      this.logger.log(`[MIGRACIÓN] Rollback completado sin errores`);
    }
  }

  // ── Helper: construir credenciales router ──────────────────
  private buildCreds(row: any, prefix: 'wisp' | 'ftth') {
    const p = prefix === 'wisp' ? 'router_wisp' : '';
    const get = (field: string) => p ? row[`${p}_${field}`] : row[field];
    return {
      id:              get('id') || row.id,
      ip:              get('vpn_ip') || get('ip') || get('ip_gestion'),
      port:            get('ssl') || row.usar_ssl
        ? get('puerto_ssl') || get('puerto_api_ssl')
        : get('puerto') || get('puerto_api'),
      user:            get('usuario'),
      passwordCifrado: get('pass') || get('password_cifrado'),
      useSsl:          get('ssl') || row.usar_ssl || false,
      timeoutSec:      get('timeout') || row.timeout_conexion || 10,
      version:         ((get('version') || row.version_ros) === 'v7' ? 'v7' : 'v6') as 'v6' | 'v7',
    };
  }

  private async persistirIp(empresaId: string, segmentoId: string, contratoId: string, ip: string) {
    await this.ds.query(`
      INSERT INTO ips_asignadas (empresa_id, segmento_id, contrato_id, ip_address, tipo, activa, asignada_en)
      VALUES ($1, $2, $3, $4, 'cliente', true, NOW())
      ON CONFLICT DO NOTHING
    `, [empresaId, segmentoId, contratoId, ip]);
    await this.ds.query(
      `UPDATE contratos SET ip_asignada = $1 WHERE id = $2`,
      [ip, contratoId],
    );
  }
}
