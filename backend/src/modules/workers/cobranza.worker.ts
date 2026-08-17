import * as fs   from 'fs';
import * as path from 'path';

import {
  Process, Processor,
  OnQueueFailed, OnQueueCompleted, OnQueueStalled,
} from '@nestjs/bull';
import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { InjectQueue }         from '@nestjs/bull';
import { Job, Queue }          from 'bull';
import { SchedulerRegistry }   from '@nestjs/schedule';
import { CronJob }             from 'cron';
import { InjectDataSource }    from '@nestjs/typeorm';
import { DataSource }          from 'typeorm';
import { CACHE_MANAGER }       from '@nestjs/cache-manager';
import { Cache }               from 'cache-manager';
import { EventEmitter2 as EventEmitter } from '@nestjs/event-emitter';
import { EmpresaConfigService } from '../config/empresa-config.service';

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
import { DeudaPorContratoService } from '../facturacion/deuda-por-contrato.service';
import { PoliticaFacturacionService } from '../facturacion/politica-facturacion.service';
import { AuditoriaService }    from '../auth/auditoria.service';
import { IProvisionamientoProvider } from '../aprovisionamiento/interfaces/provisionamiento-provider.interface';

import {
  QUEUES, JOBS, JOB_OPTIONS,
  PayloadSuspenderContrato,
  PayloadReactivarContrato,
  PayloadEvaluarProrroga,
  PayloadNotificacionCobro,
} from './workers.constants';
import { decrypt } from '../../common/utils/encryption.util';
import { filasUpdateReturning } from '../../common/utils/pg-result.util';
import { RedisLockService } from '../../common/redis/redis-lock.service';
import { sqlDeudaExigible } from '../facturacion/domain/estados-con-saldo';
import { SQL_COMPROBANTE_VENCIDO } from '../facturacion/domain/mora';
import { esExito, mensajeDe } from '../../common/domain/resultado-operacion';

// ─────────────────────────────────────────────────────────────
// CobranzaScheduler — Encola los jobs en los momentos correctos
// ─────────────────────────────────────────────────────────────
@Injectable()
export class CobranzaScheduler implements OnModuleInit {
  private readonly logger = new Logger(CobranzaScheduler.name);

  constructor(
    @InjectQueue(QUEUES.COBRANZA) private readonly queue: Queue,
    @InjectDataSource()           private readonly ds: DataSource,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly empresaConfig: EmpresaConfigService,
    private readonly politicaSvc: PoliticaFacturacionService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.RUN_CRONS !== 'true') return;
    const tz = await this.empresaConfig.getTimezone().catch(() => 'America/Lima');
    const jobs: Array<[string, string, () => Promise<void>]> = [
      ['deteccion-morosos',          '* * * * *',  () => this.detectarMorosos()],
      ['barrido-nocturno-cobranza',  '5 0 * * *',  () => this.barridoNocturno()],
      ['notif-preventivas',          '* * * * *',  () => this.notificacionesPreventivas()],
      ['purgar-vouchers',            '15 0 * * *', () => this.purgarVouchersExpirados()],
    ];
    for (const [name, expr, fn] of jobs) {
      this.schedulerRegistry.addCronJob(name, new CronJob(expr, fn, null, true, tz));
    }
  }

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
  async detectarMorosos(): Promise<void> {
    if (process.env.NODE_APP_INSTANCE !== undefined && process.env.NODE_APP_INSTANCE !== '0') return;
    const [hora, min] = await this.getHoraConf('corte', '06:00');
    if (!await this.debeEjecutar('corte', hora, min)) return;

    this.logger.log('[CRON] Iniciando detección diaria de morosos');

    // El corte se decide contra la FACTURA, no contra el alta del contrato. Antes se
    // medían días desde `COALESCE(fecha_ultimo_pago, fecha_inicio)`: ese campo lo mantenía
    // el job PROCESAR_PAGO, por el que la ruta de cobro real (`pagos.service`) no pasa, así
    // que quedaba en NULL aunque el abonado hubiera pagado y el criterio degeneraba en
    // "días desde que se instaló". Incidente 2026-08-05: James Pena pagó el 04/08 y fue
    // cortado el 05/08 con su única factura pendiente venciendo el 06/08.
    //
    // Las tres fechas del ciclo salen ahora de la configuración del abonado
    // (`PoliticaFacturacionService`): vence el día de pago, se corta `diasGracia` después.
    // Aquí se lee el `fecha_vencimiento` GRABADO en cada factura, nunca recalculado: un
    // cambio de configuración no puede mover la fecha de una deuda ya notificada.
    // LA REGLA, dicha por el propietario el 2026-08-08: «el sistema te tolera N
    // comprobantes vencidos antes de cortarte, y además te ofrece N días de gracia
    // **luego del ÚLTIMO comprobante vencido**». Un comprobante cuenta como vencido desde
    // el día siguiente a su día de pago — la gracia no entra en esa cuenta.
    //
    // Aquí se medía desde `MIN(fecha_vencimiento)`, el más ANTIGUO, y eso tenía dos
    // efectos: cortaba antes de tiempo (con día de pago 10, el tercer vencimiento cae el
    // 10/03 y se cortaba el 11/03 en vez del 15/03), y sobre todo **hacía inertes los días
    // de gracia siempre que `aplicarCorte >= 2`**: para cuando se acumula el segundo
    // comprobante, el más antiguo lleva un mes y cualquier gracia razonable ya está
    // superada. La gracia solo influía con `aplicarCorte = 1`, que es justo el caso en que
    // MIN y MAX coinciden — por eso nadie lo notó.
    const morosos = await this.ds.query(`
      WITH impagas AS (
        SELECT cliente_id,
               MAX(fecha_vencimiento) AS vencimiento_del_ultimo,
               COUNT(*)::int          AS comprobantes_vencidos
          FROM facturas
         WHERE deleted_at IS NULL
           AND ${SQL_COMPROBANTE_VENCIDO()}
         GROUP BY cliente_id
      )
      SELECT
        co.id              AS contrato_id,
        co.empresa_id,
        co.cliente_id,
        co.router_id,
        co.ip_asignada,
        co.usuario_pppoe,
        co.deuda_total,
        co.meses_deuda,
        cl.facturacion_config,
        em.dias_gracia     AS dias_gracia_empresa,
        im.vencimiento_del_ultimo,
        im.comprobantes_vencidos,
        -- Días transcurridos desde el ÚLTIMO vencimiento, que es contra lo que corre la
        -- gracia. No desde el primero: ver el comentario de la regla, arriba.
        (CURRENT_DATE - im.vencimiento_del_ultimo)::int AS dias_vencido,
        cl.nombre_completo AS nombre_cliente
      FROM servicios co
      JOIN empresas em ON em.id = co.empresa_id
      JOIN clientes cl ON cl.id = co.cliente_id
      JOIN impagas  im ON im.cliente_id = co.cliente_id
      WHERE co.estado = 'activo'
        AND co.deuda_total > 0
        AND co.deleted_at IS NULL
        AND co.router_id IS NOT NULL
        AND co.ip_asignada IS NOT NULL
        AND co.usuario_pppoe IS NOT NULL
        -- Una prórroga vigente es una promesa de pago que el operador ya concedió: el
        -- corte no puede pasarle por encima, aunque la fecha de corte ya haya llegado.
        -- Su vencimiento lo evalúa el job VERIFICAR_PRORROGA.
        AND NOT (co.en_prorroga = true AND co.prorroga_hasta >= CURRENT_DATE)
      ORDER BY co.deuda_total DESC
    `);

    let suspender = 0;

    for (const c of morosos) {
      const cfg = (c.facturacion_config ?? {}) as Record<string, unknown>;
      const entero = (v: unknown): number | null => {
        const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
        return Number.isFinite(n) && n > 0 ? n : null;
      };

      // `diasGracia` es la distancia entre el vencimiento y el corte. En 0 la UI lo
      // presenta como "sin corte automático", así que no se corta.
      const diasGracia = cfg.diaPago !== undefined
        ? entero(cfg.diasGracia)
        : parseInt(c.dias_gracia_empresa || '5', 10);
      if (!diasGracia) continue;

      // `aplicarCorte` = cuántos comprobantes vencidos deben acumularse antes de cortar.
      // "Desactivado" significa que a este abonado no se le corta por mora.
      const mesesParaCorte = cfg.diaPago !== undefined ? entero(cfg.aplicarCorte) : 1;
      if (!mesesParaCorte) continue;
      if (parseInt(c.comprobantes_vencidos, 10) < mesesParaCorte) continue;

      if (parseInt(c.dias_vencido, 10) >= diasGracia) {
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
        FROM servicios co
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

    const indiceRec = parseInt(lockKey.replace('rec', ''), 10) as 1 | 2 | 3;

    // Candidatos con deuda: el offset lo decide cada abonado en su pestaña de
    // Notificaciones, así que el filtro por fecha se hace en TS y no en SQL. La fecha de
    // referencia es el vencimiento GRABADO en la factura impaga —igual que el corte—, no
    // `contratos.fecha_vencimiento`, que es una copia que puede quedar desfasada.
    const candidatos = await this.ds.query(`
      SELECT co.id              AS contrato_id,
             co.empresa_id,
             co.cliente_id,
             co.deuda_total,
             co.${campoRec}     AS dias_contrato,
             cl.nombre_completo,
             cl.whatsapp,
             cl.telefono,
             cl.notificaciones_config,
             cl.facturacion_config,
             im.vencimiento,
             (im.vencimiento - CURRENT_DATE)::int AS dias_restantes
      FROM servicios co
      JOIN clientes cl  ON cl.id  = co.cliente_id AND cl.deleted_at IS NULL
      JOIN (
        SELECT cliente_id, MIN(fecha_vencimiento) AS vencimiento
          FROM facturas
         WHERE deleted_at IS NULL
           AND ${sqlDeudaExigible()}
           AND COALESCE(saldo, total - monto_pagado) > 0
         GROUP BY cliente_id
      ) im ON im.cliente_id = co.cliente_id
      WHERE co.estado = 'activo'
        AND co.deuda_total > 0
        AND co.deleted_at IS NULL
        AND (cl.whatsapp IS NOT NULL OR cl.telefono IS NOT NULL)
      LIMIT 1000
    `);

    let encolados = 0;

    for (const c of candidatos) {
      const prefs = this.politicaSvc.notificacionesDesde(
        c.notificaciones_config ?? null, c.facturacion_config ?? null,
      );

      let toca: boolean;
      if (prefs.recordatoriosPago) {
        // Configuración del abonado: el offset es relativo al vencimiento, negativo para
        // "antes" y positivo para "después", tal como lo ofrece la pantalla.
        const rec = prefs.recordatorios.find((r) => r.indice === indiceRec);
        toca = !!rec && parseInt(c.dias_restantes, 10) === -rec.dias;
      } else if (c.notificaciones_config) {
        // Configuró sus notificaciones y dejó los recordatorios apagados: no se le escribe.
        continue;
      } else {
        // Sin configuración propia: se conserva el criterio anterior por contrato, donde
        // `dias_recordatorio_N` cuenta días ANTES del vencimiento (signo contrario).
        const dias = c.dias_contrato === null ? null : parseInt(c.dias_contrato, 10);
        toca = dias !== null && parseInt(c.dias_restantes, 10) === dias;
      }

      if (!toca) continue;

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
      encolados++;
    }

    this.logger.log(
      `[NOTIF-PREV] ${lockKey.toUpperCase()} | ${candidatos.length} candidatos | ${encolados} encolados`,
    );
  }

  // ─── PURGA DIARIA DE VOUCHERS EXPIRADOS (00:15 AM) ──────────
  // Política: vouchers con más de 90 días se borran del disco y
  // la columna comprobante_url se pone a NULL en la BD.
  // Compatible con la política de retención del módulo WhatsApp.
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
    private readonly deudaSvc:       DeudaPorContratoService,
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
        // Ola 1, grupo 3b: firewallSvc/pppoeSvc hablan ResultadoOperacion — ya no lanzan. El
        // try/catch se reemplaza por esExito(), preservando los mismos flags/mensajes: sin
        // esto, un fallo real quedaría leído como éxito (mikrotikFallido nunca se marca), la
        // regresión silenciosa exacta que esta ola existe para impedir.
        // ── 2. Agregar a Address List morosos ───────────────
        await job.progress(20);
        const rSusp = await this.firewallSvc.suspenderCliente(
          creds, ipAsignada, clienteId,
          `Suspensión automática: ${nombreCliente ?? clienteId} | S/ ${deudaTotal} — ${new Date().toLocaleDateString('es-PE')}`,
        );
        if (esExito(rSusp)) {
          this.logger.log(`✓ IP ${ipAsignada} en lista morosos | router: ${router.ip_gestion}`);
        } else {
          mikrotikFallido = true;
          errores.push(`Firewall: ${mensajeDe(rSusp)}`);
          this.logger.error(`✗ Error Address List ${ipAsignada}: ${mensajeDe(rSusp)}`);
        }

        // ── 3. Desconectar sesión PPPoE activa ──────────────
        await job.progress(40);
        const rDesc = await this.pppoeSvc.desconectarSesion(creds, usuarioPppoe);
        if (esExito(rDesc)) {
          this.logger.log(`✓ Sesión PPPoE desconectada: ${usuarioPppoe}`);
        } else {
          errores.push(`PPPoE disconnect: ${mensajeDe(rDesc)}`);
          this.logger.warn(`✗ No se pudo desconectar sesión ${usuarioPppoe}: ${mensajeDe(rDesc)}`);
        }

        // ── 4. Deshabilitar PPPoE secret (impide reconexión) ─
        const rEstado = await this.pppoeSvc.setEstado(creds, usuarioPppoe, true);
        if (esExito(rEstado)) {
          this.logger.log(`✓ PPPoE secret deshabilitado: ${usuarioPppoe}`);
        } else {
          mikrotikFallido = true;
          errores.push(`PPPoE disable: ${mensajeDe(rEstado)}`);
          this.logger.warn(`✗ No se pudo deshabilitar PPPoE ${usuarioPppoe}: ${mensajeDe(rEstado)}`);
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
      UPDATE servicios SET
        estado = 'suspendido',
        fecha_estado = NOW(),
        motivo_estado = $1
      WHERE id = $2 AND estado = 'activo'
    `, [
      `Suspensión automática: S/ ${deudaTotal} de deuda | ${new Date().toLocaleDateString('es-PE')}`,
      contratoId,
    ]);

    await this.ds.query(`
      INSERT INTO servicios_historial
        (servicio_id, empresa_id, estado_anterior, estado_nuevo, motivo, usuario_id, automatico)
      VALUES ($1, $2, 'activo', 'suspendido', $3, NULL, true)
    `, [contratoId, empresaId, `Corte automático: deuda S/ ${deudaTotal}`]);

    // Propagar al cliente. Este worker escribe `contratos` con SQL directo, así que no
    // pasa por la cascada de `ContratosService.cambiarEstado`: sin esto, el corte
    // automático dejaba al cliente figurando «activo» en el listado del ERP con su
    // servicio cortado y su PPPoE deshabilitado en el router (incidente 2026-08-04,
    // CNT-2026-000014).
    //
    // Solo si NO le queda ningún contrato dando servicio: con dos servicios y uno
    // cortado, el cliente sigue activo, que es la verdad.
    const [clienteBloqueado] = await this.ds.query<Array<{ id: string; cliente_id: string }>>(`
      UPDATE clientes cl
      SET    estado = 'suspendido', fecha_estado = NOW()
      FROM   servicios co
      WHERE  co.id = $1
        AND  cl.id = co.cliente_id
        AND  cl.estado = 'activo'
        AND  NOT EXISTS (
          SELECT 1 FROM servicios otro
          WHERE otro.cliente_id = cl.id
            AND otro.estado IN ('activo', 'pendiente_activacion')
            AND otro.deleted_at IS NULL
            AND otro.id != $1
        )
      RETURNING cl.id
    `, [contratoId]).catch((e: any) => {
      this.logger.warn(`[Cobranza] No se pudo sincronizar el estado del cliente: ${e?.message}`);
      return [];
    });

    if (clienteBloqueado?.id) {
      await this.ds.query(`
        INSERT INTO clientes_historial_estados
          (cliente_id, empresa_id, estado_anterior, estado_nuevo, motivo, usuario_id, automatico)
        VALUES ($1, $2, 'activo', 'suspendido', $3, NULL, true)
      `, [
        clienteBloqueado.id, empresaId,
        `Corte automático por deuda S/ ${deudaTotal}`,
      ]).catch(() => void 0);
    }

    // ── 6. Notificar al cliente ────────────────────────────
    await job.progress(80);
    const [cliente] = await this.ds.query(`
      SELECT cl.nombre_completo, cl.whatsapp, cl.telefono,
             em.razon_social AS empresa_nombre
      FROM servicios co
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

      // Deduplicación: si onPagoVerificado ya marcó la promesa como 'cumplida' y ejecutó
      // MikroTik, saltamos las llamadas al router para evitar doble RTT y timeouts innecesarios.
      const [promesaCumplida] = await this.ds.query<{ id: string }[]>(`
        SELECT id FROM promesas_pago
        WHERE  contrato_id = $1
          AND  estado      = 'cumplida'
          AND  resuelta_en >= NOW() - INTERVAL '5 minutes'
        LIMIT  1
      `, [contratoId]).catch(() => [] as { id: string }[]);

      if (promesaCumplida) {
        this.logger.debug(
          `[REACTIVAR] Promesa ya resuelta por evento de pago — omitiendo MikroTik para ${contratoId}`,
        );
      } else {

      // Ola 1, grupo 3b: firewallSvc/pppoeSvc hablan ResultadoOperacion — ya no lanzan.
      // ── 2. Quitar de Address Lists ─────────────────────
      const rReact = await this.firewallSvc.reactivarCliente(creds, ipAsignada);
      if (esExito(rReact)) {
        this.logger.log(`✓ IP ${ipAsignada} removida de listas de control`);
      } else {
        mikrotikFallido = true;
        errores.push(`Firewall: ${mensajeDe(rReact)}`);
        this.logger.error(`✗ Error removiendo ${ipAsignada} de Address List: ${mensajeDe(rReact)}`);
      }

      // ── 2b. Habilitar PPPoE secret (permite reconexión) ──
      const [conRow] = await this.ds.query(
        'SELECT usuario_pppoe FROM servicios WHERE id = $1',
        [contratoId],
      ).catch(() => [null]);

      if (conRow?.usuario_pppoe) {
        const rHab = await this.pppoeSvc.setEstado(creds, conRow.usuario_pppoe, false);
        if (esExito(rHab)) {
          this.logger.log(`✓ PPPoE secret habilitado: ${conRow.usuario_pppoe}`);
        } else {
          mikrotikFallido = true;
          errores.push(`PPPoE enable: ${mensajeDe(rHab)}`);
          this.logger.warn(`✗ No se pudo habilitar PPPoE ${conRow.usuario_pppoe}: ${mensajeDe(rHab)}`);
        }
      }

      // ── Outbox: reintento automático si el router no respondió ─
      if (mikrotikFallido) {
        await this.outboxSvc.encolar('REACTIVAR', contratoId, routerId, {
          ipAsignada, usuarioPppoe: conRow?.usuario_pppoe,
        }).catch(e => this.logger.error(`OutboxRed encolar REACTIVAR: ${e.message}`));
      }

      } // cierre else (promesaCumplida)

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
      SELECT ciclo_facturacion, estado FROM servicios WHERE id = $1
    `, [contratoId]).catch(() => [null]);

    const estadoAnterior = contratoData?.estado ?? 'suspendido';
    const ciclo = contratoData?.ciclo_facturacion ?? 'mensual';
    const meses = CICLO_MESES[ciclo] ?? 1;
    const nuevaFechaVenc = new Date();
    nuevaFechaVenc.setMonth(nuevaFechaVenc.getMonth() + meses);
    const nuevaFechaStr = nuevaFechaVenc.toISOString().split('T')[0];

    // Deuda real antes de reactivar. Es la ÚLTIMA puerta: protege contra jobs encolados cuando
    // el pago era parcial o quedaban otras facturas.
    //
    // H-7 (2026-08-09): medía `sqlDeudaExigible` SIN filtro de fecha, igual que los otros dos
    // caminos de reactivación. Era el más grave de los tres porque decide al final — podía
    // CANCELAR una reactivación que `pagos.service` ya había autorizado, dejando al abonado
    // pagado y sin servicio. Ahora los tres preguntan lo mismo a la misma función.
    let deudaRestante  = 0;
    let mesesRestantes = 0;
    try {
      const vencida  = await this.deudaSvc.vencidaQueBloquea(contratoId, clienteId);
      deudaRestante  = vencida.monto;
      mesesRestantes = vencida.comprobantes;
    } catch (e: any) {
      this.logger.warn(`[REACTIVAR] No se pudo calcular deuda para ${contratoId}: ${e.message} — procediendo`);
    }

    if (deudaRestante > 0) {
      // Se refresca la proyección con el MISMO cálculo que usa el resto del ERP, en vez
      // de escribir aquí el total del cliente sobre un solo contrato. Escribirlo a mano
      // era lo que hacía que la ficha mostrara una cifra y esta puerta decidiera con
      // otra: el operador cobraba lo que veía y la reactivación se negaba igual.
      await this.deudaSvc.recalcularPorCliente(clienteId, empresaId).catch(() => void 0);
      this.logger.warn(
        `[REACTIVAR] Cancelado: contrato ${contratoId} aún tiene deuda S/ ${deudaRestante} ` +
        `en ${mesesRestantes} factura(s) — el servicio permanece suspendido`,
      );
      return { contratoId, ipAsignada, errores, cancelado: true, deudaRestante };
    }

    // RETURNING id para saber si realmente cambió de estado (evita historial fantasma).
    const [contratoActualizado] = filasUpdateReturning<{ id: string }>(await this.ds.query(`
      UPDATE servicios SET
        estado = 'activo',
        fecha_estado = NOW(),
        motivo_estado = 'Reactivación automática por pago registrado',
        en_prorroga = false,
        prorroga_hasta = NULL,
        fecha_vencimiento = $2
      WHERE id = $1 AND estado = 'suspendido'
      RETURNING id
    `, [contratoId, nuevaFechaStr]));

    if (contratoActualizado) {
      // La proyección de deuda NO se pone a cero a mano: se RECALCULA desde las facturas.
      //
      // Este UPDATE escribía `deuda_total = 0, meses_deuda = 0`, y era el segundo escritor de
      // una proyección que A-4 dejó con uno solo. Desde H-7 además es falso: la reactivación
      // ocurre cuando la deuda VENCIDA es cero, y el abonado puede tener un comprobante
      // emitido y todavía sin vencer. Ponerla a cero lo borraría de la ficha — el mismo
      // defecto del incidente 2026-08-04 (ficha S/64, deuda real S/128), del revés.
      await this.deudaSvc.recalcularPorCliente(clienteId, empresaId)
        .catch((e: any) => this.logger.warn(`[REACTIVAR] No se pudo refrescar la deuda: ${e?.message}`));

      await this.ds.query(`
        INSERT INTO servicios_historial
          (servicio_id, empresa_id, estado_anterior, estado_nuevo, motivo, usuario_id, automatico)
        VALUES ($1, $2, $3, 'activo', $4, NULL, true)
      `, [contratoId, empresaId, estadoAnterior, `Reactivación automática por pago | Nuevo vencimiento: ${nuevaFechaStr}`]);
    }

    // Sincronizar clientes.estado: si no quedan contratos suspendidos del cliente → activo
    const [clienteActualizado] = filasUpdateReturning<{ id: string }>(await this.ds.query(`
      UPDATE clientes
      SET estado = 'activo', fecha_estado = NOW()
      WHERE id = $1
        AND estado = 'suspendido'
        AND NOT EXISTS (
          SELECT 1 FROM servicios
          WHERE cliente_id = $1
            AND estado = 'suspendido'
            AND deleted_at IS NULL
            AND id != $2
        )
      RETURNING id
    `, [clienteId, contratoId]).catch((e: any) => {
      this.logger.warn(`[REACTIVAR] No se pudo sincronizar clientes.estado: ${e.message}`);
      return [];
    }));

    if (clienteActualizado) {
      await this.ds.query(`
        INSERT INTO clientes_historial_estados
          (cliente_id, empresa_id, estado_anterior, estado_nuevo, motivo, usuario_id, automatico)
        VALUES ($1, $2, 'suspendido', 'activo', $3, NULL, true)
      `, [
        clienteId,
        empresaId,
        `Reactivación automática por pago | Contrato: ${contratoId}`,
      ]).catch((e: any) =>
        this.logger.warn(`[REACTIVAR] No se pudo insertar historial cliente: ${e.message}`),
      );
    }

    // ── 4. Notificar ───────────────────────────────────────
    await job.progress(85);
    if (notificar !== false) {
      const [cliente] = await this.ds.query(`
        SELECT cl.nombre_completo, cl.whatsapp, cl.telefono
        FROM servicios co JOIN clientes cl ON cl.id = co.cliente_id
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
      FROM servicios co
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
  // AQUÍ VIVÍA EL JOB `PROCESAR_PAGO` — eliminado en F3 (2026-08-06)
  //
  // Era un SEGUNDO aplicador de dinero: llamaba a `aplicarPago`, recalculaba la deuda,
  // escribía `fecha_ultimo_pago` y encolaba la reactivación. Nunca se encolaba —
  // `enqueueProcesarPago` no tenía un solo llamador— porque la ruta de cobro real
  // (`PagosService.registrar`) hace todo eso ella misma.
  //
  // No era código muerto inofensivo: ya causó un incidente. El corte por mora se medía
  // contra `fecha_ultimo_pago`, un campo que SOLO mantenía este job, así que quedaba en
  // NULL aunque el abonado hubiera pagado y el criterio degeneraba en "días desde que se
  // instaló". El 05/08 cortaron a James Pena al día siguiente de pagar, con su factura
  // venciendo el 06/08. El corte ya se arregló mirando la factura; esto es retirar el
  // arma que quedó cargada.
  //
  // Si alguna vez hace falta aplicar un pago desde un job, se llama a
  // `PagosService.registrar` o al `AplicadorFacturaService`. No se reescribe el flujo.
  // ────────────────────────────────────────────────────────────

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
