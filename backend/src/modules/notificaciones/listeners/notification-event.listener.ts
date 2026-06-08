import { Injectable, Logger, Inject } from '@nestjs/common';
import { OnEvent }             from '@nestjs/event-emitter';
import { InjectQueue }         from '@nestjs/bull';
import { Queue }               from 'bull';
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
  ) {}

  // ── Helper: encolar en Bull ────────────────────────────────
  private async encolar(tipo: string, payload: PayloadNotificacionEnvio): Promise<void> {
    try {
      await this.queue.add(JOBS.NOTIF_ENVIO, payload, JOB_OPTIONS.NOTIFICACION);
      this.logger.log(`[EVENT] Encolado ${tipo} → ${payload.telefono}`);
    } catch (err: any) {
      this.logger.error(`[EVENT] Error encolando ${tipo}: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // FACTURA EMITIDA
  // ═══════════════════════════════════════════════════════════
  @OnEvent(NOTIFICATION_EVENTS.FACTURA_EMITIDA, { async: true })
  async onFacturaEmitida(event: EventNotificacionFacturaEmitida): Promise<void> {
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
