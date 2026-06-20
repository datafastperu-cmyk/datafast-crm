import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource }  from '@nestjs/typeorm';
import { DataSource }        from 'typeorm';
import { Cron }              from '@nestjs/schedule';
import { EventEmitter2 }     from '@nestjs/event-emitter';

import { FirewallService }   from '../mikrotik/services/firewall.service';
import { PppoeService }      from '../mikrotik/services/pppoe.service';
import { QueueService }      from '../mikrotik/services/queue.service';
import { decrypt }           from '../../common/utils/encryption.util';
import {
  NOTIFICATION_EVENTS,
  EventOutboxRedAgotado,
} from '../notificaciones/events/notification.events';

export type AccionRed = 'SUSPENDER' | 'REACTIVAR' | 'DESPROVISIONAR' | 'PROVISIONAR';

export interface PayloadSuspenderRed {
  ipAsignada:  string;
  usuarioPppoe?: string;
  clienteId:   string;
  deudaTotal?: number;
}

export interface PayloadReactivarRed {
  ipAsignada:  string;
  usuarioPppoe?: string;
}

export interface PayloadDesprovisionarRed {
  contratoId:   string;
  motivo:       string;
}

export interface PayloadProvisionarRed {
  contratoId:    string;
  clienteId:     string;
  usuarioPppoe:  string;
  passwordPppoe: string;
  ipAsignada:    string;
  perfilPppoe:   string;
  downloadMbps:  number;
  uploadMbps:    number;
  tipoQueue:     string;
}

// ─────────────────────────────────────────────────────────────
// OutboxRedService — Reintentos automáticos de comandos MikroTik
// cuando el router estaba inalcanzable en el momento del evento.
// Cron cada 5 minutos, hasta 12 intentos (~1 hora).
// ─────────────────────────────────────────────────────────────
@Injectable()
export class OutboxRedService {
  private readonly logger = new Logger(OutboxRedService.name);

  constructor(
    @InjectDataSource()    private readonly ds:          DataSource,
    private readonly firewallSvc: FirewallService,
    private readonly pppoeSvc:    PppoeService,
    private readonly queueSvc:    QueueService,
    private readonly events:      EventEmitter2,
  ) {}

  /**
   * Guarda un comando de red en la cola de reintentos.
   * Idempotente: si ya existe PENDIENTE para (contratoId, accion), no duplica.
   */
  async encolar(
    accion:     AccionRed,
    contratoId: string,
    routerId:   string,
    payload:    PayloadSuspenderRed | PayloadReactivarRed | PayloadDesprovisionarRed | PayloadProvisionarRed,
  ): Promise<void> {
    await this.ds.query(`
      INSERT INTO comandos_red_pendientes (contrato_id, router_id, accion, payload)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (contrato_id, accion) WHERE estado = 'PENDIENTE' DO NOTHING
    `, [contratoId, routerId, accion, JSON.stringify(payload)]);

    this.logger.warn(
      `[OutboxRed] ${accion} encolado → contrato=${contratoId} router=${routerId}`,
    );
  }

  /**
   * Encola desprovisión cuando la baja definitiva falla en hardware.
   * Usa router_id = 'none' porque se re-consulta en ejecución.
   */
  async encolarDesprovisionar(contratoId: string, motivo: string): Promise<void> {
    await this.encolar('DESPROVISIONAR', contratoId, 'none', { contratoId, motivo });
  }

  async encolarProvisionar(
    contratoId: string,
    routerId:   string,
    payload:    PayloadProvisionarRed,
  ): Promise<void> {
    await this.encolar('PROVISIONAR', contratoId, routerId, payload);
  }

  // ────────────────────────────────────────────────────────────
  // CRON — cada 5 minutos procesa hasta 10 comandos pendientes
  // ────────────────────────────────────────────────────────────
  @Cron('0 */5 * * * *')
  async procesarPendientes(): Promise<void> {
    // SELECT FOR UPDATE SKIP LOCKED: dos instancias PM2 nunca toman el mismo
    // registro. SKIP LOCKED descarta filas bloqueadas por otra instancia en lugar
    // de esperar, eliminando deadlocks y doble ejecución.
    const pendientes = await this.ds.transaction(async (em) => {
      return em.query<any[]>(`
        SELECT id, contrato_id, router_id, accion, payload, intentos, max_intentos
        FROM   comandos_red_pendientes
        WHERE  estado = 'PENDIENTE' AND intentos < max_intentos
        ORDER  BY creado_en
        LIMIT  10
        FOR UPDATE SKIP LOCKED
      `);
    });

    if (pendientes.length === 0) return;

    this.logger.log(`[OutboxRed] Procesando ${pendientes.length} comando(s) pendiente(s)`);

    for (const cmd of pendientes) {
      await this.ejecutarComando(cmd);
    }
  }

  // ────────────────────────────────────────────────────────────
  // Ejecución individual
  // ────────────────────────────────────────────────────────────
  private async ejecutarComando(cmd: any): Promise<void> {
    const [router] = await this.ds.query<any[]>(
      `SELECT ip_gestion, vpn_ip, usuario, password_cifrado,
              usar_ssl, puerto_api, puerto_api_ssl, version_ros, timeout_conexion
       FROM   routers WHERE id = $1`,
      [cmd.router_id],
    ).catch(() => [null]);

    if (!router) {
      await this.ds.query(`
        UPDATE comandos_red_pendientes
        SET    estado = 'AGOTADO', ultimo_error = 'Router eliminado de BD'
        WHERE  id = $1
      `, [cmd.id]);
      this.logger.error(`[OutboxRed] Router ${cmd.router_id} no existe — comando ${cmd.id} descartado`);
      return;
    }

    const creds = this.buildCreds(cmd.router_id, router);
    const payload = cmd.payload as any;

    try {
      if (cmd.accion === 'SUSPENDER') {
        await this.firewallSvc.suspenderCliente(
          creds,
          payload.ipAsignada,
          payload.clienteId,
          `Mora reintento outbox — intento ${cmd.intentos + 1}`,
        );
        if (payload.usuarioPppoe) {
          await this.pppoeSvc.desconectarSesion(creds, payload.usuarioPppoe);
          await this.pppoeSvc.setEstado(creds, payload.usuarioPppoe, true);
        }
      } else if (cmd.accion === 'REACTIVAR') {
        await this.firewallSvc.reactivarCliente(creds, payload.ipAsignada);
        if (payload.usuarioPppoe) {
          await this.pppoeSvc.setEstado(creds, payload.usuarioPppoe, false);
        }
      } else if (cmd.accion === 'DESPROVISIONAR') {
        // Para DESPROVISIONAR: eliminar PPPoE secret o regla ARP del router
        const [contratoRow] = await this.ds.query<any[]>(`
          SELECT co.usuario_pppoe AS "usuarioPppoe",
                 co.ip_asignada   AS "ipAsignada",
                 co.mac_address   AS "macAddress",
                 co.tipo_auth     AS "tipoAuth",
                 ro.tipo_control  AS "tipoControl"
          FROM contratos co
          LEFT JOIN routers ro ON ro.id = co.router_id
          WHERE co.id = $1
        `, [cmd.contrato_id]).catch(() => [null]);

        if (contratoRow) {
          const rawTipo = contratoRow.tipoAuth ?? contratoRow.tipoControl ?? 'ninguna';
          const tipo    = rawTipo === 'pppoe_addresslist' ? 'pppoe' : rawTipo;
          if (tipo === 'pppoe' && contratoRow.usuarioPppoe) {
            await this.pppoeSvc.eliminar(creds, contratoRow.usuarioPppoe);
          }
        }
      } else if (cmd.accion === 'PROVISIONAR') {
        const p = payload as PayloadProvisionarRed;

        // Paso A: PPPoE (upsert — idempotente si ya existía de un intento previo)
        await this.pppoeSvc.crear(creds, {
          name:          p.usuarioPppoe,
          password:      p.passwordPppoe,
          profile:       p.perfilPppoe || 'default',
          service:       'pppoe',
          remoteAddress: p.ipAsignada,
          comment:       `DATAFAST:ClienteID:${p.clienteId}`,
          disabled:      false,
        });

        // Paso B: Simple Queue (upsert — idempotente)
        if (!p.tipoQueue || p.tipoQueue === 'simple_queue') {
          await this.queueSvc.crearSimpleQueue(creds, {
            name:         p.usuarioPppoe,
            target:       `${p.ipAsignada}/32`,
            maxLimitDown: p.downloadMbps,
            maxLimitUp:   p.uploadMbps,
            comment:      `DATAFAST:ClienteID:${p.clienteId}`,
          });
        }
      }

      await this.ds.query(`
        UPDATE comandos_red_pendientes
        SET    estado = 'EJECUTADO', ejecutado_en = NOW()
        WHERE  id = $1
      `, [cmd.id]);

      this.logger.log(
        `[OutboxRed] ✅ ${cmd.accion} ejecutado → contrato=${cmd.contrato_id} intento=${cmd.intentos + 1}`,
      );
    } catch (err: any) {
      const nuevosIntentos = (cmd.intentos as number) + 1;
      const agotado        = nuevosIntentos >= cmd.max_intentos;

      await this.ds.query(`
        UPDATE comandos_red_pendientes
        SET    intentos = $2, ultimo_error = $3, estado = $4
        WHERE  id = $1
      `, [cmd.id, nuevosIntentos, err.message?.slice(0, 500), agotado ? 'AGOTADO' : 'PENDIENTE']);

      if (agotado) {
        this.logger.error(
          `[OutboxRed] ❌ AGOTADO → contrato=${cmd.contrato_id} accion=${cmd.accion} | ${err.message}`,
        );
        // Obtener empresaId para enrutar la notificación
        const [row] = await this.ds.query<any[]>(
          `SELECT empresa_id FROM contratos WHERE id = $1 LIMIT 1`,
          [cmd.contrato_id],
        ).catch(() => [null]);

        this.events.emit(NOTIFICATION_EVENTS.OUTBOX_RED_AGOTADO, {
          contratoId:  cmd.contrato_id,
          routerId:    cmd.router_id,
          accion:      cmd.accion,
          ultimoError: (err.message ?? 'Error desconocido').slice(0, 200),
          empresaId:   row?.empresa_id ?? undefined,
        } satisfies EventOutboxRedAgotado);
      } else {
        this.logger.warn(
          `[OutboxRed] Reintento ${nuevosIntentos}/${cmd.max_intentos} → contrato=${cmd.contrato_id}: ${err.message}`,
        );
      }
    }
  }

  private buildCreds(routerId: string, router: any) {
    let password = '';
    try { password = decrypt(router.password_cifrado); }
    catch { password = router.password_cifrado ?? ''; }

    return {
      id:              routerId,
      ip:              router.vpn_ip || router.ip_gestion,
      port:            router.usar_ssl
                         ? (router.puerto_api_ssl ?? 8729)
                         : (router.puerto_api    ?? 8728),
      user:            router.usuario ?? 'admin',
      passwordCifrado: router.password_cifrado ?? '',
      useSsl:          router.usar_ssl ?? false,
      timeoutSec:      router.timeout_conexion ?? 10,
      version:         (router.version_ros === 'v7' ? 'v7' : 'v6') as 'v6' | 'v7',
    };
  }
}
