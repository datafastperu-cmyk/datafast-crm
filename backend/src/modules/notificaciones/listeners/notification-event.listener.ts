import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent }                          from '@nestjs/event-emitter';
import { InjectQueue }                      from '@nestjs/bull';
import { Queue }                            from 'bull';
import { InjectDataSource }                 from '@nestjs/typeorm';
import { DataSource }                       from 'typeorm';
import { ModuleHealthService }              from '../../../common/services/module-health.service';
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
  EventNotificacionEmisorCaido,
  EventNotificacionEmisorConectado,
  EventNotificacionRouterCaido,
  EventNotificacionRouterConectado,
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
export class NotificationEventListener implements OnModuleInit {
  private readonly logger = new Logger(NotificationEventListener.name);

  private degraded = false;

  constructor(
    @InjectQueue(QUEUES.NOTIFICACIONES) private readonly queue: Queue,
    @InjectDataSource()                 private readonly ds:    DataSource,
    private readonly moduleHealth: ModuleHealthService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ds.query(`SELECT 1 FROM notificaciones_logs LIMIT 0`);
      this.moduleHealth.registrar('notificaciones', 'ok');
    } catch (err: any) {
      this.degraded = true;
      this.moduleHealth.registrar('notificaciones', 'degraded', err.message);
    }
  }

  // ── Helper: encolar en Bull ────────────────────────────────
  // Crea el log ENCOLADO en BD ANTES de encolar para que el mensaje
  // sea visible en /mensajeria/enviados desde el primer instante.
  private async encolar(
    tipo: string,
    payload: PayloadNotificacionEnvio,
    jobOptions: object = JOB_OPTIONS.NOTIFICACION,
  ): Promise<void> {
    if (this.degraded) {
      this.logger.warn(`[notificaciones] Módulo degradado — notificación '${tipo}' descartada`);
      return;
    }
    // 1. Registrar en notificaciones_logs con estado ENCOLADO
    let logId: string | undefined;
    try {
      const [row] = await this.ds.query(`
        INSERT INTO notificaciones_logs (empresa_id, contrato_id, telefono, tipo_template, estado_entrega)
        VALUES ($1, $2, $3, $4, 'ENCOLADO') RETURNING id
      `, [payload.empresaId ?? null, payload.contratoId ?? null, payload.telefono.substring(0, 30), tipo]);
      logId = row?.id ?? undefined;
    } catch (dbErr: any) {
      this.logger.warn(`[EVENT] No se pudo crear log para ${tipo}: ${dbErr.message}`);
    }

    // 2. Encolar en Bull con el logId para que el Worker no cree un duplicado
    try {
      const job = await this.queue.add(
        JOBS.NOTIF_ENVIO,
        { ...payload, logId },
        jobOptions,
      );
      this.logger.log(
        `[EVENT] Encolado ${tipo} → ${payload.telefono.substring(0, 9)}... ` +
        `| jobId=${job.id} | logId=${logId ?? 'sin-log'} | empresa=${payload.empresaId ?? '?'}`,
      );
    } catch (err: any) {
      this.logger.error(`[EVENT] Error encolando ${tipo}: ${err.message}`);
      // Evitar log huérfano en estado ENCOLADO si Bull no pudo aceptar el job
      if (logId) {
        await this.ds.query(
          `UPDATE notificaciones_logs SET estado_entrega = 'FALLIDO', error_detalle = $1 WHERE id = $2`,
          [`Bull queue.add failed: ${err.message}`.substring(0, 500), logId],
        ).catch(() => {});
      }
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
        // snake_case para plantillas (no-META)
        numero_factura:    event.numeroFactura,
        monto:             event.montoTotal,
        fecha_vencimiento: event.fechaVencimiento,
        // camelCase para META_GRAPH paramKeys
        clienteNombre:     event.clienteNombre,
        numeroFactura:     event.numeroFactura,
        montoTotal:        event.montoTotal,
        fechaVencimiento:  event.fechaVencimiento,
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
        monto:          event.montoPago,
        metodo_pago:    event.metodoPago,
        saldo_pendiente: event.saldoPendiente,
        // META compat
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
        monto:         event.deudaTotal,
        numero_cuenta: event.numeroCuenta ?? '',
        // META compat
        clienteNombre: event.clienteNombre,
        deudaTotal:    event.deudaTotal,
        numeroCuenta:  event.numeroCuenta ?? 'ver al asesor',
        nombreEmpresa: event.nombreEmpresa ?? '',
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
        // todo enriquecido desde BD (nombre_cliente, plan, empresa, etc.)
        // META compat
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
        // todo enriquecido desde BD (nombre_cliente, plan, usuario_pppoe, etc.)
        // META compat
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
        monto:     event.montoDeuda,
        link_pago: event.linkPago ?? '',
        // META compat
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
        monto:         event.montoDeuda,
        dias_vencidos: event.diasVencido,
        numero_cuenta: event.numeroCuenta ?? '',
        // META compat
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

  // ═══════════════════════════════════════════════════════════
  // MONITOREO DE INFRAESTRUCTURA
  // Estos handlers reciben eventos del módulo de monitoreo.
  // El destino es whatsapp_corporativo de la empresa (resuelto en resolveDestino).
  // ═══════════════════════════════════════════════════════════

  @OnEvent(NOTIFICATION_EVENTS.EMISOR_CAIDO, { async: true })
  async onEmisorCaido(event: EventNotificacionEmisorCaido): Promise<void> {
    this.logger.log(`[EVENT] ⚠️ EMISOR_CAIDO → nodo=${event.nodoNombre} | empresa=${event.empresaId}`);
    await this.encolar('emisor_caido', {
      telefono:  '',
      tipo:      'emisor_caido',
      variables: { nodo_nombre: event.nodoNombre },
      empresaId: event.empresaId,
    }, JOB_OPTIONS.ALERTA);
  }

  @OnEvent(NOTIFICATION_EVENTS.EMISOR_CONECTADO, { async: true })
  async onEmisorConectado(event: EventNotificacionEmisorConectado): Promise<void> {
    this.logger.log(`[EVENT] ✅ EMISOR_CONECTADO → nodo=${event.nodoNombre} | empresa=${event.empresaId}`);
    await this.encolar('emisor_conectado', {
      telefono:  '',
      tipo:      'emisor_conectado',
      variables: { nodo_nombre: event.nodoNombre },
      empresaId: event.empresaId,
    }, JOB_OPTIONS.ALERTA);
  }

  @OnEvent(NOTIFICATION_EVENTS.ROUTER_CAIDO, { async: true })
  async onRouterCaido(event: EventNotificacionRouterCaido): Promise<void> {
    this.logger.log(`[EVENT] ⚠️ ROUTER_CAIDO → router=${event.routerNombre} | empresa=${event.empresaId}`);
    await this.encolar('router_caido', {
      telefono:  '',
      tipo:      'router_caido',
      variables: { router_nombre: event.routerNombre },
      empresaId: event.empresaId,
    }, JOB_OPTIONS.ALERTA);
  }

  @OnEvent(NOTIFICATION_EVENTS.ROUTER_CONECTADO, { async: true })
  async onRouterConectado(event: EventNotificacionRouterConectado): Promise<void> {
    this.logger.log(`[EVENT] ✅ ROUTER_CONECTADO → router=${event.routerNombre} | empresa=${event.empresaId}`);
    await this.encolar('router_conectado', {
      telefono:  '',
      tipo:      'router_conectado',
      variables: { router_nombre: event.routerNombre },
      empresaId: event.empresaId,
    }, JOB_OPTIONS.ALERTA);
  }
}
