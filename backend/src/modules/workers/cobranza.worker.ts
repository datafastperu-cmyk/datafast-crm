import * as fs   from 'fs';
import * as path from 'path';

import {
  Process, Processor,
  OnQueueFailed, OnQueueCompleted, OnQueueStalled,
} from '@nestjs/bull';
import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectQueue }         from '@nestjs/bull';
import { Job, Queue }          from 'bull';
import { Cron }                from '@nestjs/schedule';
import { InjectDataSource }    from '@nestjs/typeorm';
import { DataSource }          from 'typeorm';
import { CACHE_MANAGER }       from '@nestjs/cache-manager';
import { Cache }               from 'cache-manager';
import { EventEmitter2 as EventEmitter } from '@nestjs/event-emitter';

import { FirewallService }           from '../mikrotik/services/firewall.service';
import { PppoeService }              from '../mikrotik/services/pppoe.service';
import { OutboxRedService }          from '../outbox-red/outbox-red.service';
import { GatewayMensajeriaService }  from '../notificaciones/services/gateway-mensajeria.service';
import { TipoNotificacion }          from '../notificaciones/services/whatsapp.service';
import {
  NOTIFICATION_EVENTS,
  EventNotificacionPagoRecibido,
} from '../notificaciones/events/notification.events';
import { FacturacionService }        from '../facturacion/facturacion.service';
import { AuditoriaService }    from '../auth/auditoria.service';
import { IProvisionamientoProvider } from '../aprovisionamiento/interfaces/provisionamiento-provider.interface';

import {
  QUEUES, JOBS, JOB_OPTIONS,
  PayloadSuspenderContrato,
  PayloadReactivarContrato,
  PayloadEvaluarProrroga,
  PayloadProcesarPago,
  PayloadNotificacionCobro,
} from './workers.constants';
import { decrypt } from '../../common/utils/encryption.util';
import { RedisLockService } from '../../common/redis/redis-lock.service';

// ─────────────────────────────────────────────────────────────
// CobranzaScheduler — Encola los jobs en los momentos correctos
// ─────────────────────────────────────────────────────────────
@Injectable()
export class CobranzaScheduler {
  private readonly logger = new Logger(CobranzaScheduler.name);

  constructor(
    @InjectQueue(QUEUES.COBRANZA) private readonly queue: Queue,
    @InjectDataSource()           private readonly ds: DataSource,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  // Lee el horario configurado para un job; devuelve [hora, minuto]
  private async getHoraConf(key: string, defaultHora = '05:00'): Promise<[number, number]> {
    const cacheKey = `cron:horario:${key}`;
    let valor = await this.cache.get<string>(cacheKey);

    if (!valor) {
      const [emp] = await this.ds.query(
        `SELECT cron_horarios->>'${key}' AS hora FROM empresas LIMIT 1`,
      ).catch(() => [null]);
      valor = emp?.hora ?? defaultHora;
      await this.cache.set(cacheKey, valor, 5 * 60 * 1000); // cache 5 min
    }

    const [h, m] = (valor as string).split(':').map(Number);
    return [h || 0, m || 0];
  }

  // Retorna true si es el momento de ejecutar y adquiere un lock diario
  private async debeEjecutar(jobKey: string, hora: number, minuto: number): Promise<boolean> {
    const now = new Date();
    if (now.getHours() !== hora || now.getMinutes() !== minuto) return false;

    const lockKey = `cron:ran:${jobKey}:${now.toISOString().split('T')[0]}`;
    const yaCorrio = await this.cache.get(lockKey);
    if (yaCorrio) return false;

    await this.cache.set(lockKey, '1', 23 * 60 * 60 * 1000); // lock 23h
    return true;
  }

  // ─── DETECCIÓN DIARIA DE MOROSOS ──────────────────────────
  // Busca contratos activos con deuda y los suspende si superan
  // los días de gracia configurados por la empresa.
  @Cron('* * * * *', { timeZone: 'America/Lima', name: 'deteccion-morosos' })
  async detectarMorosos(): Promise<void> {
    if (process.env.NODE_APP_INSTANCE !== undefined && process.env.NODE_APP_INSTANCE !== '0') return;
    const [hora, min] = await this.getHoraConf('corte', '06:00');
    if (!await this.debeEjecutar('corte', hora, min)) return;

    this.logger.log('[CRON] Iniciando detección diaria de morosos');

    const morosos = await this.ds.query(`
      SELECT
        co.id              AS contrato_id,
        co.empresa_id,
        co.cliente_id,
        co.router_id,
        co.ip_asignada,
        co.usuario_pppoe,
        co.deuda_total,
        co.meses_deuda,
        em.dias_gracia AS dias_gracia_corte,
        EXTRACT(DAY FROM (NOW() - COALESCE(co.fecha_ultimo_pago, co.fecha_inicio)::timestamptz))::int
          AS dias_sin_pago,
        cl.nombre_completo AS nombre_cliente
      FROM contratos co
      JOIN empresas em ON em.id = co.empresa_id
      JOIN clientes cl ON cl.id = co.cliente_id
      WHERE co.estado = 'activo'
        AND co.deuda_total > 0
        AND co.deleted_at IS NULL
        AND co.router_id IS NOT NULL
        AND co.ip_asignada IS NOT NULL
        AND co.usuario_pppoe IS NOT NULL
      ORDER BY co.deuda_total DESC
    `);

    let suspender = 0;

    for (const c of morosos) {
      const diasGracia = parseInt(c.dias_gracia_corte || '5', 10);

      if (parseInt(c.dias_sin_pago, 10) > diasGracia) {
        await this.queue.add(
          JOBS.SUSPENDER_CONTRATO,
          {
            contratoId:    c.contrato_id,
            empresaId:     c.empresa_id,
            clienteId:     c.cliente_id,
            routerId:      c.router_id,
            ipAsignada:    c.ip_asignada,
            usuarioPppoe:  c.usuario_pppoe,
            deudaTotal:    parseFloat(c.deuda_total),
            mesesDeuda:    parseInt(c.meses_deuda, 10),
            nombreCliente: c.nombre_cliente,
          } as PayloadSuspenderContrato,
          {
            ...JOB_OPTIONS.CRITICO,
            delay: suspender * 1000,
          },
        );
        suspender++;
      }
    }

    this.logger.log(
      `[CRON] Detección morosos: ${morosos.length} encontrados | ${suspender} a suspender`,
    );
  }

  // ─── BARRIDO NOCTURNO (00:05 AM) ─────────────────────────────
  // Escenario único: Recordatorios personalizados (dias_recordatorio_N)
  // La prórroga ya no cambia estado — el contrato permanece ACTIVO
  // hasta que detectarMorosos lo suspende al superar los días de gracia.
  // Solo instancia 0 del clúster PM2 ejecuta este barrido.
  @Cron('5 0 * * *', { timeZone: 'America/Lima', name: 'barrido-nocturno-cobranza' })
  async barridoNocturno(): Promise<void> {
    if (process.env.NODE_APP_INSTANCE !== undefined && process.env.NODE_APP_INSTANCE !== '0') return;

    const inicio = Date.now();
    this.logger.log('═══ BARRIDO NOCTURNO cobranza iniciado ═══');

    let countR = 0;

    // ── Recordatorios personalizados por contrato ─
    try {
      const recordatorios: Array<{
        id: string; empresa_id: string; cliente_id: string;
        numero_contrato: string; fecha_vencimiento: string;
        precio_final: number; whatsapp: string | null; telefono: string | null;
      }> = await this.ds.query(`
        SELECT co.id, co.empresa_id, co.cliente_id, co.numero_contrato,
               co.fecha_vencimiento,
               CAST(co.precio_final AS FLOAT) AS precio_final,
               cl.whatsapp, cl.telefono
        FROM contratos co
        JOIN clientes cl ON cl.id = co.cliente_id AND cl.deleted_at IS NULL
        WHERE co.estado = 'activo'
          AND co.fecha_vencimiento IS NOT NULL
          AND co.deleted_at IS NULL
          AND (
            (co.dias_recordatorio_1 IS NOT NULL
              AND co.fecha_vencimiento - co.dias_recordatorio_1 = CURRENT_DATE)
            OR (co.dias_recordatorio_2 IS NOT NULL
              AND co.fecha_vencimiento - co.dias_recordatorio_2 = CURRENT_DATE)
            OR (co.dias_recordatorio_3 IS NOT NULL
              AND co.fecha_vencimiento - co.dias_recordatorio_3 = CURRENT_DATE)
          )
      `);

      for (const r of recordatorios) {
        const tel = r.whatsapp || r.telefono;
        if (!tel) continue;
        const diasRestantes = Math.round(
          (new Date(r.fecha_vencimiento).getTime() - Date.now()) / 86_400_000,
        );
        await this.queue.add(
          JOBS.NOTIF_COBRO_PREVIO,
          {
            clienteId:  r.cliente_id,
            empresaId:  r.empresa_id,
            telefono:   tel,
            nombre:     '',
            montoDeuda: r.precio_final,
            diasAntes:  diasRestantes,
            facturaIds: [],
          },
          JOB_OPTIONS.NOTIFICACION,
        );
        countR++;
      }
    } catch (err) {
      this.logger.warn(`[C] Error recordatorios personalizados: ${err.message}`);
    }

    const ms = Date.now() - inicio;
    this.logger.log(
      `═══ BARRIDO NOCTURNO completado en ${ms}ms | R=${countR} recordatorios ═══`,
    );
  }

  // ─── NOTIFICACIONES PREVENTIVAS ───────────────────────────
  // Corre cada minuto; ejecuta en la hora configurada para cada recordatorio.
  // Usa dias_recordatorio_N del contrato para determinar qué contratos aplican
  // en cada franja horaria, eliminando el hardcode anterior de [3, 1] días.
  @Cron('* * * * *', { timeZone: 'America/Lima', name: 'notif-preventivas' })
  async notificacionesPreventivas(): Promise<void> {
    if (process.env.NODE_APP_INSTANCE !== undefined && process.env.NODE_APP_INSTANCE !== '0') return;
    const [hora1, min1] = await this.getHoraConf('recordatorio1', '09:00');
    const [hora2, min2] = await this.getHoraConf('recordatorio2', '12:00');
    const [hora3, min3] = await this.getHoraConf('recordatorio3', '19:00');

    const now = new Date();
    const h   = now.getHours();
    const m   = now.getMinutes();
    const hoy = now.toISOString().split('T')[0];

    // Determinar qué franja disparó y qué campo de recordatorio aplica
    let lockKey:  string | null = null;
    let campoRec: string | null = null;

    if      (h === hora1 && m === min1 && !await this.cache.get(`cron:ran:rec1:${hoy}`)) {
      lockKey = 'rec1'; campoRec = 'dias_recordatorio_1';
    } else if (h === hora2 && m === min2 && !await this.cache.get(`cron:ran:rec2:${hoy}`)) {
      lockKey = 'rec2'; campoRec = 'dias_recordatorio_2';
    } else if (h === hora3 && m === min3 && !await this.cache.get(`cron:ran:rec3:${hoy}`)) {
      lockKey = 'rec3'; campoRec = 'dias_recordatorio_3';
    }

    if (!lockKey || !campoRec) return;
    await this.cache.set(`cron:ran:${lockKey}:${hoy}`, '1', 23 * 60 * 60 * 1000);

    // Busca contratos donde HOY coincide exactamente con la fecha calculada
    // por el campo dias_recordatorio_N específico de ese contrato.
    // Safe: campoRec proviene de un switch interno, no de input externo.
    const porVencer = await this.ds.query(`
      SELECT co.id              AS contrato_id,
             co.empresa_id,
             co.cliente_id,
             co.fecha_vencimiento,
             co.deuda_total,
             cl.nombre_completo,
             cl.whatsapp,
             cl.telefono,
             (co.fecha_vencimiento - CURRENT_DATE)::int AS dias_restantes
      FROM contratos co
      JOIN clientes cl  ON cl.id  = co.cliente_id AND cl.deleted_at IS NULL
      JOIN empresas em  ON em.id  = co.empresa_id
      WHERE co.estado = 'activo'
        AND co.deuda_total > 0
        AND co.deleted_at IS NULL
        AND (cl.whatsapp IS NOT NULL OR cl.telefono IS NOT NULL)
        AND co.${campoRec} IS NOT NULL
        AND (co.fecha_vencimiento - co.${campoRec}) = CURRENT_DATE
      LIMIT 1000
    `);

    for (const c of porVencer) {
      await this.queue.add(
        JOBS.NOTIF_COBRO_PREVIO,
        {
          clienteId:  c.cliente_id,
          empresaId:  c.empresa_id,
          contratoId: c.contrato_id,
          telefono:   c.whatsapp || c.telefono,
          nombre:     c.nombre_completo,
          montoDeuda: parseFloat(c.deuda_total),
          diasAntes:  parseInt(c.dias_restantes, 10),
          facturaIds: [],
        } as PayloadNotificacionCobro,
        JOB_OPTIONS.NOTIFICACION,
      );
    }

    this.logger.log(
      `[NOTIF-PREV] ${lockKey.toUpperCase()} | campo: ${campoRec} | ${porVencer.length} contratos encolados`,
    );
  }

  // ─── PURGA DIARIA DE VOUCHERS EXPIRADOS (00:15 AM) ──────────
  // Política: vouchers con más de 90 días se borran del disco y
  // la columna comprobante_url se pone a NULL en la BD.
  // Compatible con la política de retención del módulo WhatsApp.
  @Cron('15 0 * * *', { timeZone: 'America/Lima', name: 'purgar-vouchers' })
  async purgarVouchersExpirados(): Promise<void> {
    if (process.env.NODE_APP_INSTANCE !== undefined && process.env.NODE_APP_INSTANCE !== '0') return;

    const uploadDir = process.env.APP_UPLOAD_DIR || '/app/uploads';
    const corte = new Date();
    corte.setDate(corte.getDate() - 90);
    const fechaCorte = corte.toISOString().split('T')[0];

    const rows: Array<{ id: string; comprobante_url: string }> = await this.ds.query(`
      SELECT id, comprobante_url
      FROM pagos
      WHERE comprobante_url IS NOT NULL
        AND created_at <= $1::date
    `, [fechaCorte]);

    if (!rows.length) return;

    let borrados  = 0;
    let fallidos  = 0;
    const ids: string[] = [];

    for (const row of rows) {
      try {
        // Construir ruta física a partir de la URL relativa (/uploads/...)
        const relativo = row.comprobante_url.replace(/^\/uploads\//, '');
        const filePath = path.join(uploadDir, relativo);

        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        ids.push(row.id);
        borrados++;
      } catch (err) {
        fallidos++;
        this.logger.warn(
          `[PURGA-VOUCHERS] No se pudo borrar ${row.comprobante_url}: ${err.message}`,
        );
      }
    }

    if (ids.length) {
      // Batch update: poner comprobante_url = NULL en los procesados
      await this.ds.query(
        `UPDATE pagos SET comprobante_url = NULL WHERE id = ANY($1)`,
        [ids],
      );
    }

    this.logger.log(
      `[PURGA-VOUCHERS] Vouchers ≥ 90 días — borrados: ${borrados} | fallidos: ${fallidos}`,
    );
  }

  // ─── Método público para encolar reactivación desde PagosService ─
  async enqueueReactivacion(payload: PayloadReactivarContrato): Promise<void> {
    await this.queue.add(JOBS.REACTIVAR_CONTRATO, payload, JOB_OPTIONS.CRITICO);
    this.logger.log(`Reactivación encolada: contrato ${payload.contratoId}`);
  }

  async enqueueProcesarPago(payload: PayloadProcesarPago): Promise<void> {
    await this.queue.add(JOBS.PROCESAR_PAGO, payload, {
      ...JOB_OPTIONS.CRITICO,
      priority: 1, // Alta prioridad
    });
  }
}

// ─────────────────────────────────────────────────────────────
// CobranzaWorker — Ejecuta los jobs de cobranza
// ─────────────────────────────────────────────────────────────
@Processor(QUEUES.COBRANZA)
export class CobranzaWorker {
  private readonly logger = new Logger(CobranzaWorker.name);

  constructor(
    private readonly firewallSvc:    FirewallService,
    private readonly pppoeSvc:       PppoeService,
    private readonly gatewaySvc:     GatewayMensajeriaService,
    private readonly facturacionSvc: FacturacionService,
    private readonly auditoria:      AuditoriaService,
    private readonly events:         EventEmitter,
    private readonly outboxSvc:      OutboxRedService,
    private readonly redisLock:      RedisLockService,
    @InjectDataSource() private readonly ds: DataSource,
    @Inject('PROVISIONAMIENTO_PROVIDER') private readonly provisionamientoSvc: IProvisionamientoProvider,
  ) {}

  // ────────────────────────────────────────────────────────────
  // JOB: SUSPENDER CONTRATO
  // 1. Agrega IP a Address List "morosos" en Mikrotik
  // 2. Desconecta sesión PPPoE activa
  // 3. Actualiza estado en BD
  // 4. Notifica al cliente por WhatsApp
  // ────────────────────────────────────────────────────────────
  @Process({ name: JOBS.SUSPENDER_CONTRATO, concurrency: 5 })
  async processSuspenderContrato(job: Job<PayloadSuspenderContrato>): Promise<any> {
    const { contratoId, empresaId, clienteId, routerId, ipAsignada, usuarioPppoe, deudaTotal, nombreCliente } = job.data;

    this.logger.log(
      `[SUSPENDER] Contrato ${contratoId} | IP: ${ipAsignada} | Deuda: S/ ${deudaTotal}`,
    );

    const errores: string[] = [];
    let mikrotikFallido    = false;

    // ── 1. Obtener credenciales del router ────────────────────
    const [router] = await this.ds.query(`
      SELECT ip_gestion, vpn_ip, usuario, password_cifrado, usar_ssl,
             puerto_api, puerto_api_ssl, version_ros, timeout_conexion
      FROM routers WHERE id = $1
    `, [routerId]).catch(() => [null]);

    if (router) {
      const creds = this.buildCreds(routerId, router);

      // Lock distribuido: evita que aprovisionamiento y cobranza actúen
      // simultáneamente sobre el mismo router desde distintos procesos PM2.
      await this.redisLock.withLock(`router:${routerId}`, 35_000, async () => {
        // ── 2. Agregar a Address List morosos ───────────────
        await job.progress(20);
        try {
          await this.firewallSvc.suspenderCliente(
            creds, ipAsignada, clienteId,
            `Suspensión automática: ${nombreCliente ?? clienteId} | S/ ${deudaTotal} — ${new Date().toLocaleDateString('es-PE')}`,
          );
          this.logger.log(`✓ IP ${ipAsignada} en lista morosos | router: ${router.ip_gestion}`);
        } catch (err) {
          mikrotikFallido = true;
          errores.push(`Firewall: ${err.message}`);
          this.logger.error(`✗ Error Address List ${ipAsignada}: ${err.message}`);
        }

        // ── 3. Desconectar sesión PPPoE activa ──────────────
        await job.progress(40);
        try {
          await this.pppoeSvc.desconectarSesion(creds, usuarioPppoe);
          this.logger.log(`✓ Sesión PPPoE desconectada: ${usuarioPppoe}`);
        } catch (err) {
          errores.push(`PPPoE disconnect: ${err.message}`);
          this.logger.warn(`✗ No se pudo desconectar sesión ${usuarioPppoe}: ${err.message}`);
        }

        // ── 4. Deshabilitar PPPoE secret (impide reconexión) ─
        try {
          await this.pppoeSvc.setEstado(creds, usuarioPppoe, true);
          this.logger.log(`✓ PPPoE secret deshabilitado: ${usuarioPppoe}`);
        } catch (err) {
          mikrotikFallido = true;
          errores.push(`PPPoE disable: ${err.message}`);
          this.logger.warn(`✗ No se pudo deshabilitar PPPoE ${usuarioPppoe}: ${err.message}`);
        }
      }).catch((lockErr) => {
        // Si no adquirió el lock, loguear y continuar — el Outbox reintentará
        mikrotikFallido = true;
        errores.push(`Lock router: ${lockErr.message}`);
        this.logger.warn(`[SUSPENDER] No se adquirió lock para router ${routerId}: ${lockErr.message}`);
      });

      // ── Outbox: reintento automático si el router no respondió ─
      if (mikrotikFallido) {
        await this.outboxSvc.encolar('SUSPENDER', contratoId, routerId, {
          ipAsignada, usuarioPppoe, clienteId, deudaTotal,
        }).catch(e => this.logger.error(`OutboxRed encolar SUSPENDER: ${e.message}`));
      }
    } else {
      errores.push(`Router ${routerId} no encontrado`);
    }

    // ── 5. Actualizar estado en BD ─────────────────────────
    await job.progress(60);
    await this.ds.query(`
      UPDATE contratos SET
        estado = 'suspendido',
        fecha_estado = NOW(),
        motivo_estado = $1
      WHERE id = $2 AND estado = 'activo'
    `, [
      `Suspensión automática: S/ ${deudaTotal} de deuda | ${new Date().toLocaleDateString('es-PE')}`,
      contratoId,
    ]);

    await this.ds.query(`
      INSERT INTO contratos_historial
        (contrato_id, empresa_id, estado_anterior, estado_nuevo, motivo, usuario_id, automatico)
      VALUES ($1, $2, 'activo', 'suspendido', $3, 'sistema', true)
    `, [contratoId, empresaId, `Corte automático: deuda S/ ${deudaTotal}`]);

    // ── 6. Notificar al cliente ────────────────────────────
    await job.progress(80);
    const [cliente] = await this.ds.query(`
      SELECT cl.nombre_completo, cl.whatsapp, cl.telefono,
             em.razon_social AS empresa_nombre
      FROM contratos co
      JOIN clientes cl ON cl.id = co.cliente_id
      JOIN empresas em ON em.id = co.empresa_id
      WHERE co.id = $1
    `, [contratoId]).catch(() => [null]);

    if (cliente) {
      const tel = cliente.whatsapp || cliente.telefono;
      if (tel) {
        this.events.emit(NOTIFICATION_EVENTS.SERVICIO_SUSPENDIDO, {
          telefono:      tel,
          clienteNombre: cliente.nombre_completo,
          deudaTotal:    `S/ ${deudaTotal.toFixed(2)}`,
          numeroCuenta:  '',
          nombreEmpresa: cliente.empresa_nombre || '',
          empresaId,
          contratoId,
          clienteId,
        });
      }
    }

    // ── 7. Auditoría ───────────────────────────────────────
    await job.progress(100);
    await this.auditoria.log({
      empresaId,
      accion:      'AUTO_SUSPEND',
      modulo:      'cobranza',
      entidadId:   contratoId,
      descripcion: `Suspensión automática: IP ${ipAsignada} | Deuda: S/ ${deudaTotal} | Errores: ${errores.length}`,
    });

    // Emitir evento para WebSocket
    this.events.emit('mikrotik.cliente.suspendido', {
      clienteId, empresaId, ip: ipAsignada, routerId, contratoId,
    });

    this.logger.log(
      `[SUSPENDER] ✅ Contrato ${contratoId} suspendido | ` +
      `${errores.length ? `ERRORES: ${errores.join(', ')}` : 'sin errores'}`,
    );

    return { contratoId, ipAsignada, errores };
  }

  // ────────────────────────────────────────────────────────────
  // JOB: REACTIVAR CONTRATO
  // 1. Quita IP de Address Lists (morosos, prorroga)
  // 2. Activa el usuario PPPoE
  // 3. Actualiza estado en BD
  // 4. Notifica al cliente
  // ────────────────────────────────────────────────────────────
  @Process({ name: JOBS.REACTIVAR_CONTRATO, concurrency: 5 })
  async handleReactivarContrato(job: Job<PayloadReactivarContrato>): Promise<any> {
    const { contratoId, empresaId, clienteId, routerId, ipAsignada, planNombre, notificar } = job.data;

    this.logger.log(`[REACTIVAR] Contrato ${contratoId} | IP: ${ipAsignada}`);

    // ── 0. Estrategia de aprovisionamiento (Patrón Estrategia) ─
    try {
      const ok = await this.provisionamientoSvc.reactivarServicio(contratoId, job.data);
      if (!ok) throw new Error('El proveedor de red rechazó la activación');
      this.logger.log(`[REACTIVAR] Proveedor confirmó activación para contrato ${contratoId}`);
    } catch (err) {
      this.logger.error(`[REACTIVAR] Proveedor rechazó activación para contrato ${contratoId}: ${err.message}`);
      throw new Error('El proveedor de red rechazó la activación');
    }

    const errores: string[] = [];
    let mikrotikFallido    = false;

    // ── 1. Credenciales del router ─────────────────────────
    const [router] = await this.ds.query(
      'SELECT ip_gestion, vpn_ip, usuario, password_cifrado, usar_ssl, puerto_api, puerto_api_ssl, version_ros, timeout_conexion FROM routers WHERE id = $1',
      [routerId],
    ).catch(() => [null]);

    if (router) {
      const creds = this.buildCreds(routerId, router);

      await job.progress(25);

      // ── 2. Quitar de Address Lists ─────────────────────
      try {
        await this.firewallSvc.reactivarCliente(creds, ipAsignada);
        this.logger.log(`✓ IP ${ipAsignada} removida de listas de control`);
      } catch (err) {
        mikrotikFallido = true;
        errores.push(`Firewall: ${err.message}`);
        this.logger.error(`✗ Error removiendo ${ipAsignada} de Address List: ${err.message}`);
      }

      // ── 2b. Habilitar PPPoE secret (permite reconexión) ──
      const [conRow] = await this.ds.query(
        'SELECT usuario_pppoe FROM contratos WHERE id = $1',
        [contratoId],
      ).catch(() => [null]);

      if (conRow?.usuario_pppoe) {
        try {
          await this.pppoeSvc.setEstado(creds, conRow.usuario_pppoe, false);
          this.logger.log(`✓ PPPoE secret habilitado: ${conRow.usuario_pppoe}`);
        } catch (err) {
          mikrotikFallido = true;
          errores.push(`PPPoE enable: ${err.message}`);
          this.logger.warn(`✗ No se pudo habilitar PPPoE ${conRow.usuario_pppoe}: ${err.message}`);
        }
      }

      // ── Outbox: reintento automático si el router no respondió ─
      if (mikrotikFallido) {
        await this.outboxSvc.encolar('REACTIVAR', contratoId, routerId, {
          ipAsignada, usuarioPppoe: conRow?.usuario_pppoe,
        }).catch(e => this.logger.error(`OutboxRed encolar REACTIVAR: ${e.message}`));
      }

      await job.progress(50);
    } else {
      errores.push(`Router ${routerId} no encontrado`);
      this.logger.warn(`Router ${routerId} no encontrado para reactivar ${contratoId}`);
    }

    // ── 3. Actualizar estado en BD ─────────────────────────
    await job.progress(70);

    // Calcular nueva fecha_vencimiento según ciclo de facturación
    const CICLO_MESES: Record<string, number> = {
      mensual: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12,
    };
    const [contratoData] = await this.ds.query(`
      SELECT ciclo_facturacion, estado FROM contratos WHERE id = $1
    `, [contratoId]).catch(() => [null]);

    const estadoAnterior = contratoData?.estado ?? 'suspendido';
    const ciclo = contratoData?.ciclo_facturacion ?? 'mensual';
    const meses = CICLO_MESES[ciclo] ?? 1;
    const nuevaFechaVenc = new Date();
    nuevaFechaVenc.setMonth(nuevaFechaVenc.getMonth() + meses);
    const nuevaFechaStr = nuevaFechaVenc.toISOString().split('T')[0];

    await this.ds.query(`
      UPDATE contratos SET
        estado = 'activo',
        fecha_estado = NOW(),
        motivo_estado = 'Reactivación automática por pago registrado',
        en_prorroga = false,
        prorroga_hasta = NULL,
        fecha_vencimiento = $2,
        deuda_total = 0,
        meses_deuda = 0
      WHERE id = $1 AND estado = 'suspendido'
    `, [contratoId, nuevaFechaStr]);

    await this.ds.query(`
      INSERT INTO contratos_historial
        (contrato_id, empresa_id, estado_anterior, estado_nuevo, motivo, usuario_id, automatico)
      VALUES ($1, $2, $3, 'activo', $4, 'sistema', true)
    `, [contratoId, empresaId, estadoAnterior, `Reactivación automática por pago | Nuevo vencimiento: ${nuevaFechaStr}`]);

    // ── 4. Notificar ───────────────────────────────────────
    await job.progress(85);
    if (notificar !== false) {
      const [cliente] = await this.ds.query(`
        SELECT cl.nombre_completo, cl.whatsapp, cl.telefono
        FROM contratos co JOIN clientes cl ON cl.id = co.cliente_id
        WHERE co.id = $1
      `, [contratoId]).catch(() => [null]);

      if (cliente) {
        const tel = cliente.whatsapp || cliente.telefono;
        if (tel) {
          this.events.emit(NOTIFICATION_EVENTS.SERVICIO_REACTIVADO, {
            telefono:      tel,
            clienteNombre: cliente.nombre_completo,
            planNombre:    planNombre || '',
            empresaId,
            contratoId,
            clienteId,
          });
        }
      }
    }

    await job.progress(100);

    // Emitir evento WebSocket
    this.events.emit('mikrotik.cliente.reactivado', {
      clienteId, empresaId, ip: ipAsignada, routerId, contratoId,
    });

    await this.auditoria.log({
      empresaId,
      accion:      'AUTO_REACTIVATE',
      modulo:      'cobranza',
      entidadId:   contratoId,
      descripcion: `Reactivación automática: IP ${ipAsignada} | Errores: ${errores.length}`,
    });

    this.logger.log(
      `[REACTIVAR] ✅ Contrato ${contratoId} reactivado | ` +
      `${errores.length ? `ERRORES: ${errores.join(', ')}` : 'sin errores'}`,
    );

    return { contratoId, ipAsignada, errores };
  }

  // ────────────────────────────────────────────────────────────
  // JOB: VENCER PRÓRROGA
  // Cuando vence la prórroga y sigue sin pagar → suspender
  // ────────────────────────────────────────────────────────────
  @Process({ name: JOBS.VENCER_PRORROGA, concurrency: 3 })
  async processVencerProrroga(job: Job<PayloadEvaluarProrroga>): Promise<any> {
    const { contratoId, empresaId, clienteId, prorrogaHasta } = job.data;

    this.logger.log(`[PRORROGA] Verificando vencimiento: contrato ${contratoId} | hasta: ${prorrogaHasta}`);

    // Obtener datos completos del contrato
    const [contrato] = await this.ds.query(`
      SELECT co.id, co.deuda_total, co.router_id,
             co.ip_asignada, co.usuario_pppoe, co.meses_deuda, co.estado,
             cl.nombre_completo AS nombre_cliente
      FROM contratos co
      JOIN clientes cl ON cl.id = co.cliente_id
      WHERE co.id = $1 AND co.deleted_at IS NULL
    `, [contratoId]);

    if (!contrato) {
      this.logger.warn(`Contrato ${contratoId} no encontrado para evaluar prórroga`);
      return { omitido: true };
    }

    // Verificar que sigue en prórroga y tiene deuda
    if (parseFloat(contrato.deuda_total) <= 0) {
      this.logger.log(`Contrato ${contratoId}: sin deuda, no requiere suspensión`);
      return { omitido: true };
    }

    // La prórroga venció y sigue debiendo → suspender
    await this.enqueueCobranza(JOBS.SUSPENDER_CONTRATO, {
      contratoId,
      empresaId,
      clienteId,
      routerId:      contrato.router_id,
      ipAsignada:    contrato.ip_asignada,
      usuarioPppoe:  contrato.usuario_pppoe,
      deudaTotal:    parseFloat(contrato.deuda_total),
      mesesDeuda:    contrato.meses_deuda,
      nombreCliente: contrato.nombre_cliente,
      notificar:     true,
    } as PayloadSuspenderContrato);

    this.logger.log(
      `[PRORROGA] ✅ Prórroga vencida el ${prorrogaHasta} — suspensión encolada para ${contratoId}`,
    );

    return { contratoId, prorrogaHasta, accion: 'suspendido' };
  }

  // ────────────────────────────────────────────────────────────
  // JOB: PROCESAR PAGO Y REACTIVAR SI APLICA
  // Cuando se registra un pago verificado, aplica a la factura
  // y evalúa si el contrato puede reactivarse.
  // ────────────────────────────────────────────────────────────
  @Process({ name: JOBS.PROCESAR_PAGO, concurrency: 10 })
  async processPago(job: Job<PayloadProcesarPago>): Promise<any> {
    const { pagoId, facturaId, contratoId, empresaId, montoPago, fechaPago } = job.data;

    this.logger.log(`[PAGO] Procesando: pago=${pagoId} | factura=${facturaId} | monto=S/${montoPago}`);

    // ── 1. Aplicar pago a la factura ──────────────────────
    await job.progress(25);
    const facturaActualizada = await this.facturacionSvc.aplicarPago(
      facturaId, montoPago, empresaId, fechaPago,
    );

    // ── 2. Recalcular deuda del cliente (facturas por clienteId) ─
    await job.progress(50);

    // Obtener clienteId desde la factura (facturas unificadas tienen contrato_id = NULL)
    const [facturaInfo] = await this.ds.query(
      `SELECT cliente_id FROM facturas WHERE id = $1`,
      [facturaId],
    );
    const clienteId = facturaInfo?.cliente_id ?? contratoId; // fallback a contratoId si no hay factura

    const [deudaRow] = await this.ds.query(`
      SELECT
        COALESCE(SUM(saldo), 0)::DECIMAL AS deuda,
        COUNT(*) FILTER (WHERE estado IN ('emitida','pagada_parcial','vencida','en_cobranza'))::INT AS meses
      FROM facturas
      WHERE cliente_id = $1 AND estado != 'anulada' AND deleted_at IS NULL
    `, [clienteId]);

    const nuevaDeuda  = parseFloat(deudaRow?.deuda || '0');
    const nuevosMeses = parseInt(deudaRow?.meses || '0', 10);

    // Actualizar deuda en todos los contratos activos del cliente
    await this.ds.query(`
      UPDATE contratos SET deuda_total = $1, meses_deuda = $2, fecha_ultimo_pago = $3
      WHERE cliente_id = $4 AND estado != 'baja_definitiva' AND deleted_at IS NULL
    `, [nuevaDeuda, nuevosMeses, fechaPago, clienteId]);

    await job.progress(75);

    // ── 3. Si la deuda quedó en cero y el contrato estaba suspendido → reactivar ─
    const [contratoInfo] = await this.ds.query(`
      SELECT co.estado, co.router_id, co.ip_asignada,
             pl.nombre AS plan_nombre, cl.id AS cliente_id,
             cl.nombre_completo, cl.whatsapp, cl.telefono,
             COALESCE(p.metodo_pago, 'efectivo') AS metodo_pago
      FROM contratos co
      JOIN planes  pl ON pl.id = co.plan_id
      JOIN clientes cl ON cl.id = co.cliente_id
      LEFT JOIN pagos p ON p.id = $2
      WHERE co.id = $1
    `, [contratoId, pagoId]).catch(() => [null]);

    if (contratoInfo && contratoInfo.estado === 'suspendido' && nuevaDeuda <= 0) {
      // Encolar reactivación con alta prioridad
      await this.enqueueCobranza(JOBS.REACTIVAR_CONTRATO, {
        contratoId,
        empresaId,
        clienteId:   contratoInfo.cliente_id,
        routerId:    contratoInfo.router_id,
        ipAsignada:  contratoInfo.ip_asignada,
        planNombre:  contratoInfo.plan_nombre,
        notificar:   true,
      } as PayloadReactivarContrato, { priority: 1 });

      this.logger.log(
        `[PAGO] 💰 Deuda saldada → reactivación encolada para contrato ${contratoId}`,
      );
    }

    // ── 4. Notificar pago al cliente ────────────────────────
    if (contratoInfo) {
      const tel = contratoInfo.whatsapp || contratoInfo.telefono;
      if (tel) {
        this.events.emit(NOTIFICATION_EVENTS.PAGO_RECIBIDO, {
          telefono:       tel,
          clienteNombre:  contratoInfo.nombre_completo,
          montoPago:      `S/ ${(montoPago as number).toFixed(2)}`,
          metodoPago:     contratoInfo.metodo_pago,
          saldoPendiente: `S/ ${nuevaDeuda.toFixed(2)}`,
          empresaId,
          contratoId,
          clienteId:      contratoInfo.cliente_id,
          pagoId,
        } satisfies EventNotificacionPagoRecibido);

        this.logger.log(`[PAGO] 📨 Evento pago.recibido emitido → ${tel.substring(0, 9)}...`);
      }
    }

    await job.progress(100);

    this.logger.log(
      `[PAGO] ✅ Pago ${pagoId} procesado | ` +
      `nueva deuda: S/ ${nuevaDeuda} | ${nuevosMeses} facturas pendientes`,
    );

    return { pagoId, contratoId, nuevaDeuda, reactivar: nuevaDeuda <= 0 };
  }

  // ── Notificaciones preventivas (vía Event Emitter → NotificationEventListener → Bull) ─
  @Process({ name: JOBS.NOTIF_COBRO_PREVIO, concurrency: 20 })
  async processNotifCobro(job: Job<PayloadNotificacionCobro>): Promise<any> {
    const { telefono, nombre, montoDeuda, diasAntes, empresaId, contratoId, clienteId } = job.data;

    if (!telefono || !montoDeuda) return { omitido: true };

    const eventName = diasAntes >= 0
      ? NOTIFICATION_EVENTS.PAGO_VENCE_HOY
      : NOTIFICATION_EVENTS.PAGO_VENCIDO;

    try {
      this.events.emit(eventName, {
        telefono,
        clienteNombre: nombre || '',
        montoDeuda:    `S/ ${montoDeuda.toFixed(2)}`,
        linkPago:      '',
        diasVencido:   diasAntes < 0 ? String(Math.abs(diasAntes)) : '0',
        numeroCuenta:  '',
        empresaId,
        contratoId:    contratoId ?? undefined,
        clienteId:     clienteId ?? undefined,
      });
      this.logger.log(`[COBRANZA] Evento emitido: ${eventName} → ${telefono}`);
      return { enviado: true, via: 'event-emitter' };
    } catch (err) {
      this.logger.warn(`[COBRANZA] Error emitiendo evento ${eventName}: ${err.message}`);
      return { enviado: false, error: err.message };
    }
  }

  // ────────────────────────────────────────────────────────────
  // HANDLERS DE COLA
  // ────────────────────────────────────────────────────────────

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(
      `[COBRANZA] ❌ Job ${job.name} #${job.id} falló ` +
      `(intento ${job.attemptsMade}/${job.opts.attempts}): ${error.message}`,
      error.stack,
    );
  }

  @OnQueueCompleted()
  onCompleted(job: Job, result: any) {
    if (result?.errores?.length) {
      this.logger.warn(
        `[COBRANZA] ⚠️ Job ${job.name} #${job.id} completado con errores: ` +
        result.errores.join(', '),
      );
    }
  }

  @OnQueueStalled()
  onStalled(job: Job) {
    this.logger.warn(
      `[COBRANZA] ⏸ Job ${job.name} #${job.id} estancado — reencolando`,
    );
  }

  // ── Helpers ───────────────────────────────────────────────
  private buildCreds(routerId: string, router: any) {
    let password = '';
    try { password = decrypt(router.password_cifrado); }
    catch { password = router.password_cifrado; }

    return {
      id:              routerId,
      ip:              router.ip_gestion,
      port:            router.usar_ssl ? router.puerto_api_ssl : router.puerto_api,
      user:            router.usuario,
      passwordCifrado: router.password_cifrado,
      useSsl:          router.usar_ssl || false,
      timeoutSec:      router.timeout_conexion || 10,
      version:         (router.version_ros === 'v7' ? 'v7' : 'v6') as 'v6' | 'v7',
    };
  }

  private async enqueueCobranza(
    jobName: string,
    payload: any,
    opts: any = JOB_OPTIONS.CRITICO,
  ): Promise<void> {
    const queue = this['queue'] as Queue;
    if (queue) await queue.add(jobName, payload, opts);
  }
}
