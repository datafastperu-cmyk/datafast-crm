import { Injectable, Logger } from '@nestjs/common';
import { OnEvent }             from '@nestjs/event-emitter';
import { GatewayMensajeriaService } from '../services/gateway-mensajeria.service';
import { TipoNotificacion }         from '../services/whatsapp.service';
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

// ─────────────────────────────────────────────────────────────
// NotificationEventListener
//
// Escucha eventos del sistema de forma desacoplada y delega el
// envío de notificaciones a GatewayMensajeriaService.
// Los eventos son emitidos desde workers/servicios después de
// completar su operación principal (facturación, suspensión, etc.)
//
// Este diseño evita que:
//   1. Una falla en el envío bloquee la operación principal
//   2. Los workers se acoplen directamente al gateway
//   3. Se pierdan notificaciones por excepciones no controladas
// ─────────────────────────────────────────────────────────────
@Injectable()
export class NotificationEventListener {
  private readonly logger = new Logger(NotificationEventListener.name);

  constructor(
    private readonly gatewaySvc: GatewayMensajeriaService,
  ) {}

  // ═══════════════════════════════════════════════════════════
  // FACTURA EMITIDA
  // ═══════════════════════════════════════════════════════════
  @OnEvent(NOTIFICATION_EVENTS.FACTURA_EMITIDA, { async: true })
  async onFacturaEmitida(event: EventNotificacionFacturaEmitida): Promise<void> {
    try {
      const result = await this.gatewaySvc.despachar({
        telefono:    event.telefono,
        tipo:        TipoNotificacion.FACTURA_EMITIDA,
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
      if (!result.enviado) {
        this.logger.warn(`[EVENT] Factura emitida no enviada: ${result.error}`);
      }
    } catch (err: any) {
      this.logger.error(`[EVENT] Error en factura emitida: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PAGO RECIBIDO
  // ═══════════════════════════════════════════════════════════
  @OnEvent(NOTIFICATION_EVENTS.PAGO_RECIBIDO, { async: true })
  async onPagoRecibido(event: EventNotificacionPagoRecibido): Promise<void> {
    try {
      const result = await this.gatewaySvc.despachar({
        telefono:    event.telefono,
        tipo:        TipoNotificacion.PAGO_RECIBIDO,
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
      if (!result.enviado) {
        this.logger.warn(`[EVENT] Pago recibido no enviado: ${result.error}`);
      }
    } catch (err: any) {
      this.logger.error(`[EVENT] Error en pago recibido: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SERVICIO SUSPENDIDO
  // ═══════════════════════════════════════════════════════════
  @OnEvent(NOTIFICATION_EVENTS.SERVICIO_SUSPENDIDO, { async: true })
  async onServicioSuspendido(event: EventNotificacionServicioSuspendido): Promise<void> {
    try {
      const result = await this.gatewaySvc.despachar({
        telefono:    event.telefono,
        tipo:        TipoNotificacion.SERVICIO_SUSPENDIDO,
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
      if (!result.enviado) {
        this.logger.warn(`[EVENT] Suspensión no notificada: ${result.error}`);
      }
    } catch (err: any) {
      this.logger.error(`[EVENT] Error en suspensión: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SERVICIO REACTIVADO
  // ═══════════════════════════════════════════════════════════
  @OnEvent(NOTIFICATION_EVENTS.SERVICIO_REACTIVADO, { async: true })
  async onServicioReactivado(event: EventNotificacionServicioReactivado): Promise<void> {
    try {
      const result = await this.gatewaySvc.despachar({
        telefono:    event.telefono,
        tipo:        TipoNotificacion.SERVICIO_REACTIVADO,
        variables: {
          clienteNombre: event.clienteNombre,
          planNombre:    event.planNombre,
        },
        empresaId:  event.empresaId,
        contratoId: event.contratoId,
        clienteId:  event.clienteId,
      });
      if (!result.enviado) {
        this.logger.warn(`[EVENT] Reactivación no notificada: ${result.error}`);
      }
    } catch (err: any) {
      this.logger.error(`[EVENT] Error en reactivación: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // BIENVENIDA
  // ═══════════════════════════════════════════════════════════
  @OnEvent(NOTIFICATION_EVENTS.BIENVENIDA, { async: true })
  async onBienvenida(event: EventNotificacionBienvenida): Promise<void> {
    try {
      const result = await this.gatewaySvc.despachar({
        telefono:    event.telefono,
        tipo:        TipoNotificacion.BIENVENIDA,
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
      if (!result.enviado) {
        this.logger.warn(`[EVENT] Bienvenida no enviada: ${result.error}`);
      }
    } catch (err: any) {
      this.logger.error(`[EVENT] Error en bienvenida: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PAGO VENCE HOY
  // ═══════════════════════════════════════════════════════════
  @OnEvent(NOTIFICATION_EVENTS.PAGO_VENCE_HOY, { async: true })
  async onPagoVenceHoy(event: EventNotificacionPagoVenceHoy): Promise<void> {
    try {
      const result = await this.gatewaySvc.despachar({
        telefono:    event.telefono,
        tipo:        TipoNotificacion.PAGO_VENCE_HOY,
        variables: {
          clienteNombre: event.clienteNombre,
          montoDeuda:    event.montoDeuda,
          linkPago:      event.linkPago ?? '',
        },
        empresaId:  event.empresaId,
        contratoId: event.contratoId,
        clienteId:  event.clienteId,
      });
      if (!result.enviado) {
        this.logger.warn(`[EVENT] Pago vence hoy no enviado: ${result.error}`);
      }
    } catch (err: any) {
      this.logger.error(`[EVENT] Error en pago vence hoy: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PAGO VENCIDO
  // ═══════════════════════════════════════════════════════════
  @OnEvent(NOTIFICATION_EVENTS.PAGO_VENCIDO, { async: true })
  async onPagoVencido(event: EventNotificacionPagoVencido): Promise<void> {
    try {
      const result = await this.gatewaySvc.despachar({
        telefono:    event.telefono,
        tipo:        TipoNotificacion.PAGO_VENCIDO,
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
      if (!result.enviado) {
        this.logger.warn(`[EVENT] Pago vencido no enviado: ${result.error}`);
      }
    } catch (err: any) {
      this.logger.error(`[EVENT] Error en pago vencido: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ALERTA EGRESO
  // ═══════════════════════════════════════════════════════════
  @OnEvent(NOTIFICATION_EVENTS.ALERTA_EGRESO, { async: true })
  async onAlertaEgreso(event: EventNotificacionAlertaEgreso): Promise<void> {
    try {
      const result = await this.gatewaySvc.despachar({
        telefono:    event.telefono,
        tipo:        TipoNotificacion.ALERTA_EGRESO,
        variables: {
          nombre_gasto:  event.nombre_gasto,
          categoria:     event.categoria,
          monto:         event.monto,
          dias_restantes: event.dias_restantes,
        },
        empresaId:  event.empresaId,
      });
      if (!result.enviado) {
        this.logger.warn(`[EVENT] Alerta egreso no enviada: ${result.error}`);
      }
    } catch (err: any) {
      this.logger.error(`[EVENT] Error en alerta egreso: ${err.message}`);
    }
  }
}