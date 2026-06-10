import { Injectable, Logger } from '@nestjs/common';
import { OnEvent }            from '@nestjs/event-emitter';
import { InjectQueue }        from '@nestjs/bull';
import { Queue }              from 'bull';
import { InjectDataSource }   from '@nestjs/typeorm';
import { DataSource }         from 'typeorm';
import {
  QUEUES, JOBS, JOB_OPTIONS,
} from '../../workers/workers.constants';
import {
  NOTIFICATION_EVENTS,
  EventNotificacionFacturaEmitida,
  EventNotificacionPagoRecibido,
  EventNotificacionServicioSuspendido,
  EventNotificacionServicioReactivado,
  EventNotificacionBienvenida,
  EventNotificacionPagoVenceHoy,
  EventNotificacionPagoVencido,
  EventNotificacionAlertaEgreso,
} from '../events/notification.events';

// ─── Payload unificado para la cola Bull ──────────────────────
export interface PayloadNotificacionEnvio {
  logId?:       string;
  telefono:     string;
  tipo:         string;
  variables:    Record<string, string>;
  empresaId?:   string;
  contratoId?:  string;
  clienteId?:   string;
}

// ─────────────────────────────────────────────────────────────
// NotificationEventListener
//
// Escucha eventos del sistema y ENCOLA en Bull (cola NOTIFICACIONES)
// para que MensajeriaWorker procese con estados:
//   ENCOLADO → (Bull procesa) → en_proceso → enviado / no_enviado
//
// Esto asegura que:
//   1. Los mensajes aparezcan en /mensajeria/enviados
//   2. Tengan reintentos automáticos (Bull)
//   3. No bloquee el worker principal (facturación/cobranza)
// ─────────────────────────────────────────────────────────────
@Injectable()
export class NotificationEventListener {
  private readonly logger = new Logger(NotificationEventListener.name);

  constructor(
    @InjectQueue(QUEUES.NOTIFICACIONES) private readonly queue: Queue,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  // ── Helper: encolar en Bull ────────────────────────────────
  // Crea el log ENCOLADO en BD ANTES de encolar para que el mensaje
  // sea visible en /mensajeria/enviados desde el primer instante.
  private async encolar(tipo: string, payload: PayloadNotificacionEnvio): Promise<void> {
    // 1. Registrar en notificaciones_logs con estado ENCOLADO
    let logId: string | undefined;
    try {
      const [row] = await this.ds.query(`
        INSERT INTO notificaciones_logs (contrato_id, telefono, tipo_template, estado_entrega)
        VALUES ($1, $2, $3, 'ENCOLADO') RETURNING id
      `, [payload.contratoId ?? null, payload.telefono.substring(0, 30), tipo]);
      logId = row?.id ?? undefined;
    } catch (dbErr: any) {
      this.logger.warn(`[EVENT] No se pudo crear log para ${tipo}: ${dbErr.message}`);
    }

    // 2. Encolar en Bull con el logId para que el Worker no cree un duplicado
    try {
      const job = await this.queue.add(
        JOBS.NOTIF_ENVIO,
        { ...payload, logId },
        JOB_OPTIONS.NOTIFICACION,
      );
      this.logger.log(
        `[EVENT] Encolado ${tipo} → ${payload.telefono.substring(0, 9)}... ` +
        `| jobId=${job.id} | logId=${logId ?? 'sin-log'} | empresa=${payload.empresaId ?? '?'}`,
      );
    } catch (err: any) {
      this.logger.error(`[EVENT] Error encolando ${tipo}: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // FACTURA EMITIDA
  // ═══════════════════════════════════════════════════════════
  @OnEvent(NOTIFICATION_EVENTS.FACTURA_EMITIDA, { async: true })
  async onFacturaEmitida(event: EventNotificacionFacturaEmitida): Promise<void> {
    this.logger.log(
      `[EVENT] 📨 Recibido FACTURA_EMITIDA → ${event.telefono?.substring(0, 9)}... ` +
      `| factura=${event.numeroFactura} | empresa=${event.empresaId}`,
    );
    await this.encolar('factura_emitida', {
      telefono:    event.telefono,
      tipo:        'factura_emitida',
      variables: {
        clienteNombre:    event.clienteNombre,
        numeroFactura:    event.numeroFactura,
        montoTotal:       event.montoTotal,
        fechaVencimiento: event.fechaVencimiento,
      },
      empresaId:  event.empresaId,
      contratoId: event.contratoId,
      clienteId:  event.clienteId,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // PAGO RECIBIDO
  // ═══════════════════════════════════════════════════════════
  @OnEvent(NOTIFICATION_EVENTS.PAGO_RECIBIDO, { async: true })
  async onPagoRecibido(event: EventNotificacionPagoRecibido): Promise<void> {
    this.logger.log(
      `[EVENT] 💰 Recibido PAGO_RECIBIDO → ${event.telefono?.substring(0, 9)}... ` +
      `| monto=${event.montoPago} | empresa=${event.empresaId}`,
    );
    await this.encolar('pago_recibido', {
      telefono:    event.telefono,
      tipo:        'pago_recibido',
      variables: {
        clienteNombre:  event.clienteNombre,
        montoPago:      event.montoPago,
        metodoPago:     event.metodoPago,
        saldoPendiente: event.saldoPendiente,
      },
      empresaId:  event.empresaId,
      contratoId: event.contratoId,
      clienteId:  event.clienteId,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // SERVICIO SUSPENDIDO
  // ═══════════════════════════════════════════════════════════
  @OnEvent(NOTIFICATION_EVENTS.SERVICIO_SUSPENDIDO, { async: true })
  async onServicioSuspendido(event: EventNotificacionServicioSuspendido): Promise<void> {
    this.logger.log(
      `[EVENT] 🔴 Recibido SERVICIO_SUSPENDIDO → ${event.telefono?.substring(0, 9)}... ` +
      `| deuda=${event.deudaTotal} | empresa=${event.empresaId}`,
    );
    await this.encolar('servicio_suspendido', {
      telefono:    event.telefono,
      tipo:        'servicio_suspendido',
      variables: {
        clienteNombre: event.clienteNombre,
        deudaTotal:    event.deudaTotal,
        numeroCuenta:  event.numeroCuenta ?? 'ver al asesor',
        nombreEmpresa: event.nombreEmpresa ?? 'CRM ISP DATAFAST',
      },
      empresaId:  event.empresaId,
      contratoId: event.contratoId,
      clienteId:  event.clienteId,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // SERVICIO REACTIVADO
  // ═══════════════════════════════════════════════════════════
  @OnEvent(NOTIFICATION_EVENTS.SERVICIO_REACTIVADO, { async: true })
  async onServicioReactivado(event: EventNotificacionServicioReactivado): Promise<void> {
    this.logger.log(
      `[EVENT] 🟢 Recibido SERVICIO_REACTIVADO → ${event.telefono?.substring(0, 9)}... ` +
      `| plan=${event.planNombre} | empresa=${event.empresaId}`,
    );
    await this.encolar('servicio_reactivado', {
      telefono:    event.telefono,
      tipo:        'servicio_reactivado',
      variables: {
        clienteNombre: event.clienteNombre,
        planNombre:    event.planNombre,
      },
      empresaId:  event.empresaId,
      contratoId: event.contratoId,
      clienteId:  event.clienteId,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // BIENVENIDA
  // ═══════════════════════════════════════════════════════════
  @OnEvent(NOTIFICATION_EVENTS.BIENVENIDA, { async: true })
  async onBienvenida(event: EventNotificacionBienvenida): Promise<void> {
    this.logger.log(
      `[EVENT] 🎉 Recibido BIENVENIDA → ${event.telefono?.substring(0, 9)}... ` +
      `| plan=${event.planNombre} | empresa=${event.empresaId}`,
    );
    await this.encolar('bienvenida', {
      telefono:    event.telefono,
      tipo:        'bienvenida',
      variables: {
        clienteNombre:   event.clienteNombre,
        planNombre:      event.planNombre,
        velocidadBajada: event.velocidadBajada,
        velocidadSubida: event.velocidadSubida,
        usuarioPppoe:    event.usuarioPppoe,
      },
      empresaId:  event.empresaId,
      contratoId: event.contratoId,
      clienteId:  event.clienteId,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // PAGO VENCE HOY
  // ═══════════════════════════════════════════════════════════
  @OnEvent(NOTIFICATION_EVENTS.PAGO_VENCE_HOY, { async: true })
  async onPagoVenceHoy(event: EventNotificacionPagoVenceHoy): Promise<void> {
    this.logger.log(
      `[EVENT] ⏰ Recibido PAGO_VENCE_HOY → ${event.telefono?.substring(0, 9)}... ` +
      `| deuda=${event.montoDeuda} | empresa=${event.empresaId}`,
    );
    await this.encolar('pago_vence_hoy', {
      telefono:    event.telefono,
      tipo:        'pago_vence_hoy',
      variables: {
        clienteNombre: event.clienteNombre,
        montoDeuda:    event.montoDeuda,
        linkPago:      event.linkPago ?? '',
      },
      empresaId:  event.empresaId,
      contratoId: event.contratoId,
      clienteId:  event.clienteId,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // PAGO VENCIDO
  // ═══════════════════════════════════════════════════════════
  @OnEvent(NOTIFICATION_EVENTS.PAGO_VENCIDO, { async: true })
  async onPagoVencido(event: EventNotificacionPagoVencido): Promise<void> {
    this.logger.log(
      `[EVENT] 🔴 Recibido PAGO_VENCIDO → ${event.telefono?.substring(0, 9)}... ` +
      `| deuda=${event.montoDeuda} | días=${event.diasVencido} | empresa=${event.empresaId}`,
    );
    await this.encolar('pago_vencido', {
      telefono:    event.telefono,
      tipo:        'pago_vencido',
      variables: {
        clienteNombre: event.clienteNombre,
        montoDeuda:    event.montoDeuda,
        diasVencido:   event.diasVencido,
        numeroCuenta:  event.numeroCuenta ?? '',
      },
      empresaId:  event.empresaId,
      contratoId: event.contratoId,
      clienteId:  event.clienteId,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // ALERTA EGRESO
  // ═══════════════════════════════════════════════════════════
  @OnEvent(NOTIFICATION_EVENTS.ALERTA_EGRESO, { async: true })
  async onAlertaEgreso(event: EventNotificacionAlertaEgreso): Promise<void> {
    this.logger.log(
      `[EVENT] 📊 Recibido ALERTA_EGRESO → ${event.nombre_gasto} | ` +
      `monto=${event.monto} | empresa=${event.empresaId}`,
    );
    await this.encolar('alerta_egreso', {
      telefono:    event.telefono,
      tipo:        'alerta_egreso',
      variables: {
        nombre_gasto:  event.nombre_gasto,
        categoria:     event.categoria,
        monto:         event.monto,
        dias_restantes: event.dias_restantes,
      },
      empresaId:  event.empresaId,
    });
  }
}
