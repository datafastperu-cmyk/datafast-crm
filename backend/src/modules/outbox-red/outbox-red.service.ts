import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectDataSource }  from '@nestjs/typeorm';
import { DataSource }        from 'typeorm';
import { Cron }              from '@nestjs/schedule';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';

import { FirewallService }   from '../mikrotik/services/firewall.service';
import { PppoeService }      from '../mikrotik/services/pppoe.service';
import { QueueService }      from '../mikrotik/services/queue.service';
import { ProvisionFtthService } from '../olt-nativo/services/provision-ftth.service';
import { decrypt }           from '../../common/utils/encryption.util';
import { EventosSistemaService } from '../sistema/eventos-sistema.service';
import {
  NOTIFICATION_EVENTS,
  EventOutboxRedAgotado,
  EventNotificacionServicioSuspendido,
  EventNotificacionServicioReactivado,
} from '../notificaciones/events/notification.events';

export type AccionRed =
  | 'SUSPENDER' | 'REACTIVAR' | 'DESPROVISIONAR' | 'PROVISIONAR'
  | 'APLICAR_PRORROGA' | 'REVOCAR_PRORROGA'
  // Ciclo de vida ONU (FTTH) — comandos independientes del corte MikroTik,
  // cada uno con su propio reintento resiliente.
  | 'SUSPENDER_ONU' | 'REACTIVAR_ONU' | 'DESAPROVISIONAR_ONU' | 'ACTUALIZAR_WAN_ONU'
  | 'REAPROVISIONAR_ONU';

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

export interface PayloadAplicarProrroga {
  promesaId:         string;
  ipAsignada:        string;
  usuarioPppoe?:     string;
  contratoEstadoPrevio: string; // para saber si re-habilitar PPPoE
  nombreCliente?:    string;
}

export interface PayloadRevocarProrroga {
  promesaId:     string;
  ipAsignada:    string;
  usuarioPppoe?: string;
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
    private readonly ftthSvc:     ProvisionFtthService,
    private readonly events:      EventEmitter2,
    @Optional() private readonly eventos?: EventosSistemaService,
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
    // 'none' = sentinela de acciones ONU (la OLT se resuelve en ejecución desde el
    // registro, no hay router MikroTik). router_id es uuid → se persiste NULL.
    const routerIdVal = routerId && routerId !== 'none' ? routerId : null;
    await this.ds.query(`
      INSERT INTO comandos_red_pendientes (contrato_id, router_id, accion, payload)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (contrato_id, accion) WHERE estado = 'PENDIENTE' DO NOTHING
    `, [contratoId, routerIdVal, accion, JSON.stringify(payload)]);

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

  async encolarAplicarProrroga(
    contratoId: string,
    routerId:   string,
    payload:    PayloadAplicarProrroga,
  ): Promise<void> {
    await this.encolar('APLICAR_PRORROGA', contratoId, routerId, payload);
  }

  async encolarRevocarProrroga(
    contratoId: string,
    routerId:   string,
    payload:    PayloadRevocarProrroga,
  ): Promise<void> {
    await this.encolar('REVOCAR_PRORROGA', contratoId, routerId, payload);
  }

  // ── Ciclo de vida ONU (FTTH) ──────────────────────────────────
  // Encola una acción sobre la ONU SOLO si el contrato tiene registro FTTH.
  // router_id = 'none' (la OLT se resuelve en ejecución desde el registro).
  // Público: además del listener de eventos, lo usa la re-sincronización de
  // estado del tab Drift (ONU suspendida con contrato con servicio o viceversa).
  async encolarOnu(
    accion:     'SUSPENDER_ONU' | 'REACTIVAR_ONU' | 'DESAPROVISIONAR_ONU' | 'ACTUALIZAR_WAN_ONU' | 'REAPROVISIONAR_ONU',
    contratoId: string,
    empresaId:  string,
  ): Promise<void> {
    const [existe] = await this.ds.query(
      `SELECT 1 FROM ftth_onu_registro WHERE contrato_id = $1 AND empresa_id = $2 LIMIT 1`,
      [contratoId, empresaId],
    ).catch(() => [null]);
    if (!existe) return; // Contrato WISP o sin ONU — nada que hacer en la OLT.

    await this.encolar(accion, contratoId, 'none', { empresaId } as any);
    this.logger.warn(`[OutboxRed] ${accion} encolado → contrato=${contratoId}`);
  }

  // Escucha las transiciones de servicio que ya emiten cobranza y contratos,
  // y encola el comando ONU independiente (reintento resiliente propio).
  @OnEvent(NOTIFICATION_EVENTS.SERVICIO_SUSPENDIDO, { async: true })
  async onServicioSuspendido(ev: EventNotificacionServicioSuspendido): Promise<void> {
    if (ev.contratoId && ev.empresaId) {
      await this.encolarOnu('SUSPENDER_ONU', ev.contratoId, ev.empresaId);
    }
  }

  @OnEvent(NOTIFICATION_EVENTS.SERVICIO_REACTIVADO, { async: true })
  async onServicioReactivado(ev: EventNotificacionServicioReactivado): Promise<void> {
    if (ev.contratoId && ev.empresaId) {
      await this.encolarOnu('REACTIVAR_ONU', ev.contratoId, ev.empresaId);
    }
  }

  // Baja definitiva: se invoca desde contratos.service (no hay evento de baja).
  async encolarDesaprovisionarOnu(contratoId: string, empresaId: string): Promise<void> {
    await this.encolarOnu('DESAPROVISIONAR_ONU', contratoId, empresaId);
  }

  // Cambio de credenciales PPPoE del contrato → re-inyectar la WAN en la ONU (routing).
  // Se invoca desde contratos.service.update. Resiliente: reintenta hasta que la OLT
  // esté disponible; omite si el contrato no tiene ONU FTTH o está en modo bridge.
  async encolarReaprovisionarOnu(contratoId: string, empresaId: string): Promise<void> {
    await this.encolarOnu('REAPROVISIONAR_ONU', contratoId, empresaId);
  }

  // Solicitud desde el panel de drift (olt-nativo) — desacoplado por evento para
  // no crear dependencia de módulo circular (OutboxRedModule ya importa OltNativoModule).
  @OnEvent('ftth.drift.reaplicar', { async: true })
  async onDriftReaplicar(ev: { contratoId: string; empresaId: string }): Promise<void> {
    if (ev?.contratoId && ev?.empresaId) {
      await this.encolarReaprovisionarOnu(ev.contratoId, ev.empresaId);
    }
  }

  // Re-sincronización de estado desde el tab Drift: la ONU debe seguir al
  // contrato (suspendido/activo cruzados → re-encolar el comando correcto).
  @OnEvent('ftth.drift.resincronizar-estado', { async: true })
  async onDriftResincronizarEstado(
    ev: { contratoId: string; empresaId: string; accion: 'SUSPENDER_ONU' | 'REACTIVAR_ONU' },
  ): Promise<void> {
    if (ev?.contratoId && ev?.empresaId && (ev.accion === 'SUSPENDER_ONU' || ev.accion === 'REACTIVAR_ONU')) {
      await this.encolarOnu(ev.accion, ev.contratoId, ev.empresaId);
    }
  }

  async encolarActualizarWanOnu(contratoId: string, empresaId: string): Promise<void> {
    await this.encolarOnu('ACTUALIZAR_WAN_ONU', contratoId, empresaId);
  }

  async getStatus(): Promise<{
    pendientes: number;
    agotados: number;
    ejecutadosUltima1h: number;
    ultimoEjecutadoEn: string | null;
  }> {
    const [row] = await this.ds.query<any[]>(`
      SELECT
        COUNT(*) FILTER (WHERE estado = 'PENDIENTE')                               AS pendientes,
        COUNT(*) FILTER (WHERE estado = 'AGOTADO')                                 AS agotados,
        COUNT(*) FILTER (WHERE estado = 'EJECUTADO' AND ejecutado_en > NOW() - INTERVAL '1 hour') AS ejecutados_ultima_1h,
        MAX(ejecutado_en)                                                           AS ultimo_ejecutado_en
      FROM comandos_red_pendientes
    `);
    return {
      pendientes:          Number(row.pendientes),
      agotados:            Number(row.agotados),
      ejecutadosUltima1h:  Number(row.ejecutados_ultima_1h),
      ultimoEjecutadoEn:   row.ultimo_ejecutado_en ?? null,
    };
  }

  // Guard anti-solapamiento: coalesce cron + eventos de reconexión concurrentes.
  private _procesando = false;

  // ────────────────────────────────────────────────────────────
  // CRON — cada 5 minutos: red de seguridad que barre la cola.
  // ────────────────────────────────────────────────────────────
  @Cron('0 */5 * * * *')
  async procesarPendientes(): Promise<void> {
    if (this._procesando) return;
    this._procesando = true;
    try {
      // Barre la cola completa en lotes hasta vaciar lo procesable en esta pasada.
      // Los comandos de routers aún caídos fallan y quedan PENDIENTE (nunca se descartan).
      // SELECT FOR UPDATE SKIP LOCKED: dos instancias PM2 nunca toman el mismo registro.
      let lote: any[];
      do {
        lote = await this.ds.transaction(async (em) => {
          return em.query<any[]>(`
            SELECT id, contrato_id, router_id, accion, payload, intentos, max_intentos
            FROM   comandos_red_pendientes
            WHERE  estado = 'PENDIENTE'
            ORDER  BY creado_en
            LIMIT  10
            FOR UPDATE SKIP LOCKED
          `);
        });
        if (lote.length > 0) {
          this.logger.log(`[OutboxRed] Procesando ${lote.length} comando(s) pendiente(s)`);
          for (const cmd of lote) {
            await this.ejecutarComando(cmd);
          }
        }
      } while (lote.length === 10);
    } finally {
      this._procesando = false;
    }
  }

  // ────────────────────────────────────────────────────────────
  // Trigger por evento — cuando un router recupera conectividad,
  // aplica de inmediato sus comandos pendientes (latencia de segundos
  // en vez de esperar al próximo cron). Cualquier router sirve de disparo:
  // los comandos son idempotentes y cada uno re-consulta su propio router;
  // los de routers aún caídos simplemente vuelven a quedar PENDIENTE.
  // ────────────────────────────────────────────────────────────
  @OnEvent(NOTIFICATION_EVENTS.ROUTER_CONECTADO, { async: true })
  async onRouterReconectado(): Promise<void> {
    await this.procesarPendientes();
  }

  // ────────────────────────────────────────────────────────────
  // Ejecución individual
  // ────────────────────────────────────────────────────────────
  private async ejecutarComando(cmd: any): Promise<void> {
    // Ciclo de vida ONU (FTTH): no usa router MikroTik, se resuelve por contrato.
    if (cmd.accion === 'SUSPENDER_ONU' || cmd.accion === 'REACTIVAR_ONU' ||
        cmd.accion === 'DESAPROVISIONAR_ONU' || cmd.accion === 'ACTUALIZAR_WAN_ONU' ||
        cmd.accion === 'REAPROVISIONAR_ONU') {
      await this.ejecutarComandoOnu(cmd);
      return;
    }

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
          // Limpiar address-lists morosos/prorroga (evita IPs huérfanas en el router)
          if (contratoRow.ipAsignada) {
            try {
              await this.firewallSvc.reactivarCliente(creds, contratoRow.ipAsignada);
            } catch (e: any) {
              this.logger.warn(`[OutboxRed] DESPROVISIONAR address-list error: ${e?.message}`);
            }
          }

          const rawTipo = contratoRow.tipoAuth ?? contratoRow.tipoControl ?? 'ninguna';
          const tipo    = rawTipo === 'pppoe_addresslist' ? 'pppoe' : rawTipo;
          if (tipo === 'pppoe' && contratoRow.usuarioPppoe) {
            await this.pppoeSvc.eliminar(creds, contratoRow.usuarioPppoe);
          }
        }
      } else if (cmd.accion === 'APLICAR_PRORROGA') {
        const p = payload as PayloadAplicarProrroga;
        await this.firewallSvc.aplicarProrroga(
          creds,
          p.ipAsignada,
          `Promesa: ${p.nombreCliente ?? p.promesaId} | ${new Date().toLocaleDateString('es-PE')}`,
        );
        // Si el contrato estaba cortado, re-habilitar el secret PPPoE
        if (p.usuarioPppoe && p.contratoEstadoPrevio === 'cortado') {
          await this.pppoeSvc.setEstado(creds, p.usuarioPppoe, false);
        }
        // Marcar mikrotik_aplicado en la promesa
        await this.ds.query(
          `UPDATE promesas_pago SET mikrotik_aplicado = TRUE, mikrotik_aplicado_en = NOW()
           WHERE id = $1`,
          [p.promesaId],
        ).catch(() => {});

      } else if (cmd.accion === 'REVOCAR_PRORROGA') {
        const p = payload as PayloadRevocarProrroga;
        await this.firewallSvc.suspenderCliente(
          creds,
          p.ipAsignada,
          cmd.contrato_id,
          `Prorroga vencida — promesa:${p.promesaId}`,
        );
        if (p.usuarioPppoe) {
          await this.pppoeSvc.desconectarSesion(creds, p.usuarioPppoe);
          await this.pppoeSvc.setEstado(creds, p.usuarioPppoe, true);
        }
        // Marcar promesa como VENCIDA y contrato como CORTADO
        await this.ds.query(
          `UPDATE promesas_pago SET estado = 'vencida', mikrotik_aplicado = TRUE, mikrotik_aplicado_en = NOW()
           WHERE id = $1`,
          [p.promesaId],
        ).catch(() => {});
        await this.ds.query(
          `UPDATE contratos SET estado = 'cortado', en_prorroga = FALSE, prorroga_hasta = NULL, fecha_estado = NOW()
           WHERE id = $1`,
          [cmd.contrato_id],
        ).catch(() => {});

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
      // Nunca se descarta: el comando queda PENDIENTE y se reintenta (cron cada 5 min
      // + trigger inmediato al reconectar el router) hasta que se aplique en hardware.
      // Un corte/reactivación es una obligación, no un "mejor esfuerzo": aunque el túnel
      // VPN esté caído días, al volver el router los cambios se aplican automáticamente.
      const nuevosIntentos = (cmd.intentos as number) + 1;

      await this.ds.query(`
        UPDATE comandos_red_pendientes
        SET    intentos = $2, ultimo_error = $3
        WHERE  id = $1
      `, [cmd.id, nuevosIntentos, err.message?.slice(0, 500)]);

      // Notificación de visibilidad tras muchos reintentos (sigue reintentando).
      if (nuevosIntentos === cmd.max_intentos) {
        this.logger.error(
          `[OutboxRed] ⚠️ ${cmd.accion} sin aplicar tras ${nuevosIntentos} intentos → ` +
          `contrato=${cmd.contrato_id} router=${cmd.router_id} (sigue reintentando) | ${err.message}`,
        );
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

        void this.eventos?.registrar({
          origen:   'mikrotik',
          codigo:   'OUTBOX_RED_AGOTADO',
          mensaje:  `Comando ${cmd.accion} sin aplicar tras ${nuevosIntentos} intentos (contrato ${cmd.contrato_id}, router ${cmd.router_id}): ${err.message}`,
          contexto: { contratoId: cmd.contrato_id, routerId: cmd.router_id, accion: cmd.accion, intentos: nuevosIntentos },
        });
      } else {
        this.logger.warn(
          `[OutboxRed] Reintento ${nuevosIntentos} → contrato=${cmd.contrato_id}: ${err.message}`,
        );
      }
    }
  }

  // ── Ejecución de comandos de ciclo de vida ONU (FTTH) ─────────
  // Mismo modelo de resiliencia que el resto del outbox: nunca se descarta;
  // si la OLT está caída, queda PENDIENTE y reintenta (cron + trigger reconexión)
  // hasta aplicarse. Si el contrato no tiene ONU, el wrapper omite → EJECUTADO.
  private async ejecutarComandoOnu(cmd: any): Promise<void> {
    const empresaId = (cmd.payload as any)?.empresaId as string;
    try {
      let res: { exitoso: boolean; mensaje: string; error?: string; skipped?: boolean };
      if (cmd.accion === 'SUSPENDER_ONU') {
        res = await this.ftthSvc.suspenderPorContrato(cmd.contrato_id, empresaId);
      } else if (cmd.accion === 'REACTIVAR_ONU') {
        res = await this.ftthSvc.rehabilitarPorContrato(cmd.contrato_id, empresaId);
      } else if (cmd.accion === 'ACTUALIZAR_WAN_ONU') {
        const r = await this.ftthSvc.actualizarWan(cmd.contrato_id, empresaId);
        // 'skipped' (bridge / sin ONU) cuenta como exitoso: no hay nada que aplicar.
        res = { exitoso: r.actualizado || !!r.skipped, mensaje: r.mensaje, error: r.error, skipped: r.skipped };
      } else if (cmd.accion === 'REAPROVISIONAR_ONU') {
        // Push ERP→OLT de drift: re-aplica la ONU con los datos guardados del registro.
        const r = await this.ftthSvc.reaplicar(cmd.contrato_id, empresaId);
        res = { exitoso: r.estado === 'activo', mensaje: r.mensaje ?? `Estado: ${r.estado}` };
      } else {
        res = await this.ftthSvc.desaprovisionarPorContrato(cmd.contrato_id, empresaId);
      }

      if (!res.exitoso) {
        throw new Error(res.error ?? res.mensaje ?? 'Operación ONU fallida');
      }

      await this.ds.query(
        `UPDATE comandos_red_pendientes SET estado = 'EJECUTADO', ejecutado_en = NOW() WHERE id = $1`,
        [cmd.id],
      );
      this.logger.log(
        `[OutboxRed] ✅ ${cmd.accion} → contrato=${cmd.contrato_id}${res.skipped ? ' (omitido: sin ONU FTTH)' : ''}`,
      );
    } catch (err: any) {
      const nuevosIntentos = (cmd.intentos as number) + 1;
      await this.ds.query(
        `UPDATE comandos_red_pendientes SET intentos = $2, ultimo_error = $3 WHERE id = $1`,
        [cmd.id, nuevosIntentos, err.message?.slice(0, 500)],
      );
      this.logger.warn(
        `[OutboxRed] Reintento ONU ${nuevosIntentos} → contrato=${cmd.contrato_id}: ${err.message}`,
      );
      if (nuevosIntentos === cmd.max_intentos) {
        void this.eventos?.registrar({
          origen:   'olt',
          codigo:   'OUTBOX_ONU_AGOTADO',
          mensaje:  `Comando ONU ${cmd.accion} sin aplicar tras ${nuevosIntentos} intentos (contrato ${cmd.contrato_id}): ${err.message}`,
          contexto: { contratoId: cmd.contrato_id, accion: cmd.accion, intentos: nuevosIntentos },
        });
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
