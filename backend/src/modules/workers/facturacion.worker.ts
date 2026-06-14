import {
  Process, Processor,
  OnQueueFailed, OnQueueCompleted,
} from '@nestjs/bull';
import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectQueue }         from '@nestjs/bull';
import { CACHE_MANAGER }       from '@nestjs/cache-manager';
import { Cache }               from 'cache-manager';
import { Job, Queue }          from 'bull';
import { Cron }                from '@nestjs/schedule';
import { InjectDataSource }    from '@nestjs/typeorm';
import { DataSource }          from 'typeorm';
import { EventEmitter2 as EventEmitter } from '@nestjs/event-emitter';

import { FacturacionService }        from '../facturacion/facturacion.service';
import { GatewayMensajeriaService }  from '../notificaciones/services/gateway-mensajeria.service';
import { TipoNotificacion }          from '../notificaciones/services/whatsapp.service';
import { AuditoriaService }          from '../auth/auditoria.service';

import {
  QUEUES, JOBS, JOB_OPTIONS,
  PayloadGenerarFacturasEmpresa,
  PayloadGenerarFacturaContrato,
} from './workers.constants';
import { TipoComprobante } from '../facturacion/entities/factura.entity';

// ─── Resultado de generación ──────────────────────────────────
interface ResultadoGeneracion {
  empresaId:    string;
  mes:          number;
  anio:         number;
  total:        number;
  exitosas:     number;
  omitidas:     number;
  errores:      number;
  montoTotal:   number;
  detalles:     Array<{ contratoId: string; resultado: string; error?: string }>;
}

// ─────────────────────────────────────────────────────────────
// FacturacionScheduler — Encola generación mensual
// ─────────────────────────────────────────────────────────────
@Injectable()
export class FacturacionScheduler {
  private readonly logger = new Logger(FacturacionScheduler.name);

  constructor(
    @InjectQueue(QUEUES.FACTURACION) private readonly queue: Queue,
    @InjectDataSource()              private readonly ds: DataSource,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  // Lee el horario configurado para un job desde empresas.cron_horarios
  private async getHoraConf(key: string, defaultHora = '05:00'): Promise<[number, number]> {
    const cacheKey = `cron:horario:${key}`;
    let valor = await this.cache.get<string>(cacheKey);
    if (!valor) {
      const [emp] = await this.ds.query(
        `SELECT cron_horarios->>'${key}' AS hora FROM empresas LIMIT 1`,
      ).catch(() => [null]);
      valor = emp?.hora ?? defaultHora;
      await this.cache.set(cacheKey, valor, 5 * 60 * 1000);
    }
    const [h, m] = (valor as string).split(':').map(Number);
    return [h || 0, m || 0];
  }

  // Adquiere lock diario — retorna false si ya corrió hoy a esta hora
  private async debeEjecutar(jobKey: string, hora: number, minuto: number): Promise<boolean> {
    const now = new Date();
    if (now.getHours() !== hora || now.getMinutes() !== minuto) return false;
    const lockKey = `cron:ran:${jobKey}:${now.toISOString().split('T')[0]}`;
    const yaCorrio = await this.cache.get(lockKey);
    if (yaCorrio) return false;
    await this.cache.set(lockKey, '1', 23 * 60 * 60 * 1000);
    return true;
  }

  // ─── GENERACIÓN DIARIA — hora dinámica desde cron_horarios ───
  // Corre cada minuto; ejecuta solo cuando la hora coincide con
  // empresas.cron_horarios.facturacion (default: 05:00 Lima)
  @Cron('* * * * *', { timeZone: 'America/Lima', name: 'facturacion-diaria' })
  async scheduleFacturacionDiaria(): Promise<void> {
    if (process.env.NODE_APP_INSTANCE !== undefined && process.env.NODE_APP_INSTANCE !== '0') return;
    const [hora, min] = await this.getHoraConf('facturacion', '05:00');
    if (!await this.debeEjecutar('facturacion-worker', hora, min)) return;

    const hoy     = new Date();
    const diaHoy  = hoy.getDate();
    const mes     = hoy.getMonth() + 1;
    const anio    = hoy.getFullYear();

    this.logger.log(
      `[FACTURACION-CRON] ${String(hora).padStart(2,'0')}:${String(min).padStart(2,'0')} | ` +
      `Día ${diaHoy}/${mes}/${anio} — verificando empresas`,
    );

    // ── 1. Marcar facturas vencidas ────────────────────────
    await this.queue.add(
      JOBS.MARCAR_FACTURAS_VENCIDAS,
      { fecha: hoy.toISOString().split('T')[0] },
      { ...JOB_OPTIONS.CRITICO, priority: 1 },
    );

    // ── 2. Encolar facturas por dia_facturacion del contrato ──
    // Cada contrato puede tener su propio día de facturación.
    // Se agrupan por empresa para evitar jobs duplicados.
    const empresas = await this.ds.query(`
      SELECT DISTINCT em.id, em.razon_social, em.serie_boleta, em.igv_rate
      FROM contratos co
      JOIN empresas em ON em.id = co.empresa_id
      WHERE co.dia_facturacion = $1
        AND co.estado = 'activo'
        AND co.deleted_at IS NULL
        AND em.estado = 'activo'
        AND em.deleted_at IS NULL
    `, [diaHoy]);

    for (let i = 0; i < empresas.length; i++) {
      await this.queue.add(
        JOBS.GENERAR_FACTURAS_EMPRESA,
        {
          empresaId:      empresas[i].id,
          mes,
          anio,
          diaFacturacion: diaHoy,
          forzar:         false,
        } as PayloadGenerarFacturasEmpresa,
        { ...JOB_OPTIONS.MASIVO, delay: i * 5000 },
      );
    }

    this.logger.log(
      `[FACTURACION-CRON] ${empresas.length} empresa(s) encoladas por día ${diaHoy}/${mes}/${anio}`,
    );
  }

  // ─── Trigger manual desde controller ─────────────────────
  async enqueueGeneracionManual(
    empresaId: string,
    mes: number,
    anio: number,
    forzar = false,
  ): Promise<string> {
    const job = await this.queue.add(
      JOBS.GENERAR_FACTURAS_EMPRESA,
      { empresaId, mes, anio, forzar } as PayloadGenerarFacturasEmpresa,
      { ...JOB_OPTIONS.MASIVO, priority: 1 },
    );
    this.logger.log(`Generación manual encolada: empresa ${empresaId} | ${mes}/${anio} | job: ${job.id}`);
    return String(job.id);
  }

  // ─── Conteo de jobs en la cola ─────────────────────────
  async getEstadoCola(): Promise<{
    waiting: number; active: number; completed: number; failed: number;
  }> {
    return this.queue.getJobCounts();
  }
}

// ─────────────────────────────────────────────────────────────
// FacturacionWorker — Procesa los jobs de facturación
// ─────────────────────────────────────────────────────────────
@Processor(QUEUES.FACTURACION)
export class FacturacionWorker {
  private readonly logger = new Logger(FacturacionWorker.name);

  constructor(
    private readonly facturacionSvc: FacturacionService,
    private readonly gatewaySvc:     GatewayMensajeriaService,
    private readonly auditoria:      AuditoriaService,
    private readonly events:         EventEmitter,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  // ────────────────────────────────────────────────────────────
  // JOB: GENERAR FACTURAS DE UNA EMPRESA (generación masiva)
  // ────────────────────────────────────────────────────────────
  @Process({ name: JOBS.GENERAR_FACTURAS_EMPRESA, concurrency: 2 })
  async processGenerarFacturasEmpresa(
    job: Job<PayloadGenerarFacturasEmpresa>,
  ): Promise<ResultadoGeneracion> {
    const { empresaId, mes, anio, diaFacturacion, forzar } = job.data;

    this.logger.log(
      `[FACTURACION] 🏢 Empresa ${empresaId} | ${mes}/${anio}` +
      `${diaFacturacion ? ` | día ${diaFacturacion}` : ''} | forzar: ${forzar}`,
    );

    await job.progress(5);

    // Obtener empresa
    const [empresa] = await this.ds.query(
      'SELECT id, razon_social, igv_rate, serie_boleta, serie_factura FROM empresas WHERE id = $1',
      [empresaId],
    );

    if (!empresa) {
      throw new Error(`Empresa ${empresaId} no encontrada`);
    }

    // Obtener contratos activos a facturar en este mes
    const contratos = await this.ds.query(`
      SELECT
        co.id                AS contrato_id,
        co.numero_contrato,
        co.cliente_id,
        co.precio_final      AS precio,
        co.dia_facturacion,
        co.fecha_instalacion,
        cl.nombre_completo   AS cliente_nombre,
        cl.whatsapp,
        cl.telefono,
        cl.email,
        pl.aplica_igv,
        pl.nombre            AS plan_nombre
      FROM contratos co
      JOIN clientes cl ON cl.id = co.cliente_id
      JOIN planes   pl ON pl.id = co.plan_id
      WHERE co.empresa_id = $1
        AND co.estado = 'activo'
        AND ($2::int IS NULL OR co.dia_facturacion = $2)
        AND co.deleted_at IS NULL
      ORDER BY co.dia_facturacion, cl.nombre_completo
    `, [empresaId, diaFacturacion ?? null]);

    const resultado: ResultadoGeneracion = {
      empresaId,
      mes, anio,
      total:      contratos.length,
      exitosas:   0,
      omitidas:   0,
      errores:    0,
      montoTotal: 0,
      detalles:   [],
    };

    await job.progress(10);

    const periodoInicio = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const periodoFin    = this.ultimoDiaMes(anio, mes);
    const igvRate       = parseFloat(empresa.igv_rate || '0.18');
    const totalContratos = contratos.length;

    // ── Procesar cada contrato ──────────────────────────────
    for (let i = 0; i < contratos.length; i++) {
      const contrato = contratos[i];

      try {
        // Actualizar progreso del job
        await job.progress(10 + Math.floor((i / totalContratos) * 80));

        // ── Verificar si ya existe factura para este periodo ─
        if (!forzar) {
          const [existente] = await this.ds.query(`
            SELECT id FROM facturas
            WHERE contrato_id = $1
              AND periodo_inicio = $2
              AND periodo_fin    = $3
              AND estado != 'anulada'
              AND deleted_at IS NULL
          `, [contrato.contrato_id, periodoInicio, periodoFin]);

          if (existente) {
            resultado.omitidas++;
            resultado.detalles.push({
              contratoId: contrato.contrato_id,
              resultado:  `Omitido — factura ${existente.id} ya existe para ${mes}/${anio}`,
            });
            continue;
          }
        }

        // ── Calcular montos con prorrateo si aplica ──────────
        let precioBase = parseFloat(contrato.precio || '0');
        let descripcionExtra = '';

        // Prorrateo: si el contrato fue instalado en este mes y no es día 1
        if (contrato.fecha_instalacion) {
          const instFecha = new Date(contrato.fecha_instalacion);
          if (instFecha.getFullYear() === anio && instFecha.getMonth() + 1 === mes) {
            const diaInst    = instFecha.getDate();
            const diasMes    = new Date(anio, mes, 0).getDate();
            const diasFact   = diasMes - diaInst + 1;
            if (diaInst > 1) {
              precioBase = Math.round((precioBase / diasMes * diasFact) * 100) / 100;
              descripcionExtra = ` (prorrateo ${diasFact}/${diasMes} días)`;
              this.logger.debug(
                `[PRORROGA] Contrato ${contrato.contrato_id}: día inst=${diaInst}, ` +
                `días=${diasFact}/${diasMes}, precio ajustado=S/${precioBase}`,
              );
            }
          }
        }

        const aplicaIgv  = contrato.aplica_igv === true || contrato.aplica_igv === 'true';
        const subtotal   = aplicaIgv
          ? Math.round((precioBase / (1 + igvRate)) * 100) / 100
          : precioBase;
        const igv        = aplicaIgv ? Math.round((precioBase - subtotal) * 100) / 100 : 0;
        const total      = Math.round(precioBase * 100) / 100;

        // ── Obtener correlativo ─────────────────────────────
        const serie = empresa.serie_boleta || 'B001';
        const [{ siguiente }] = await this.ds.query(`
          SELECT COALESCE(MAX(correlativo), 0) + 1 AS siguiente
          FROM facturas
          WHERE empresa_id = $1 AND serie = $2 AND deleted_at IS NULL
        `, [empresaId, serie]);

        const correlativo = parseInt(siguiente, 10);

        // Calcular fecha de vencimiento
        const diaVenc = Math.min((contrato.dia_facturacion || 1) + 5, 28);
        const fechaVencimiento = `${anio}-${String(mes).padStart(2, '0')}-${String(diaVenc).padStart(2, '0')}`;

        // ── Insertar factura ────────────────────────────────
        const [factura] = await this.ds.query(`
          INSERT INTO facturas (
            empresa_id, cliente_id, contrato_id,
            tipo_comprobante, serie, correlativo,
            periodo_inicio, periodo_fin,
            descripcion, subtotal, descuento, igv, total,
            monto_pagado, estado, fecha_emision, fecha_vencimiento,
            moneda, generada_automaticamente, items, created_at
          ) VALUES (
            $1, $2, $3,
            'boleta', $4, $5,
            $6, $7,
            $8, $9, 0, $10, $11,
            0, 'emitida', CURRENT_DATE, $12,
            'PEN', true, $13, NOW()
          )
          RETURNING id, numero_completo
        `, [
          empresaId, contrato.cliente_id, contrato.contrato_id,
          serie, correlativo,
          periodoInicio, periodoFin,
          `${contrato.plan_nombre} — ${this.mesNombre(mes)} ${anio}${descripcionExtra}`,
          subtotal, igv, total,
          fechaVencimiento,
          JSON.stringify([{
            descripcion:    `${contrato.plan_nombre} — ${this.mesNombre(mes)} ${anio}${descripcionExtra}`,
            cantidad:       1,
            precioUnitario: subtotal,
            subtotal,
          }]),
        ]);

        // Actualizar deuda del contrato
        await this.ds.query(`
          UPDATE contratos SET
            deuda_total = COALESCE(deuda_total, 0) + $1,
            meses_deuda = COALESCE(meses_deuda, 0) + 1
          WHERE id = $2
        `, [total, contrato.contrato_id]);

        resultado.exitosas++;
        resultado.montoTotal += total;
        resultado.detalles.push({
          contratoId: contrato.contrato_id,
          resultado:  `${serie}-${String(correlativo).padStart(8, '0')} | S/ ${total.toFixed(2)}`,
        });

        // ── Notificar al cliente por Event (desacoplado) ────
        const tel = contrato.whatsapp || contrato.telefono;
        if (tel) {
          this.events.emit('notification.factura.emitida', {
            telefono:        tel,
            clienteNombre:   contrato.cliente_nombre,
            numeroFactura:   `${serie}-${String(correlativo).padStart(8, '0')}`,
            montoTotal:      `S/ ${total.toFixed(2)}`,
            fechaVencimiento,
            empresaId,
            contratoId:      contrato.contrato_id,
            clienteId:       contrato.cliente_id,
          });
        }

      } catch (err) {
        resultado.errores++;
        resultado.detalles.push({
          contratoId: contrato.contrato_id,
          resultado:  'error',
          error:      err.message,
        });
        this.logger.error(
          `Error generando factura contrato ${contrato.numero_contrato}: ${err.message}`,
        );
      }
    }

    await job.progress(95);

    // ── Registrar en auditoría ─────────────────────────────
    await this.auditoria.log({
      empresaId,
      accion:      'BULK_INVOICE',
      modulo:      'facturacion',
      descripcion:
        `Generación masiva ${mes}/${anio}: ` +
        `${resultado.exitosas} exitosas | ${resultado.omitidas} omitidas | ` +
        `${resultado.errores} errores | Total: S/ ${resultado.montoTotal.toFixed(2)}`,
    });

    // ── Emitir evento para WebSocket/notificaciones ────────
    this.events.emit('facturacion.generacion.completada', {
      empresaId, mes, anio,
      exitosas:   resultado.exitosas,
      errores:    resultado.errores,
      montoTotal: resultado.montoTotal,
    });

    await job.progress(100);

    this.logger.log(
      `[FACTURACION] ✅ Empresa ${empresa.razon_social} | ${mes}/${anio} completado:\n` +
      `  Total:     ${resultado.total}\n` +
      `  Exitosas:  ${resultado.exitosas}\n` +
      `  Omitidas:  ${resultado.omitidas}\n` +
      `  Errores:   ${resultado.errores}\n` +
      `  Monto:     S/ ${resultado.montoTotal.toFixed(2)}`,
    );

    return resultado;
  }

  // ────────────────────────────────────────────────────────────
  // JOB: MARCAR FACTURAS VENCIDAS (diario, antes de generar)
  // ────────────────────────────────────────────────────────────
  @Process({ name: JOBS.MARCAR_FACTURAS_VENCIDAS, concurrency: 1 })
  async processMarcarVencidas(job: Job<{ fecha: string }>): Promise<{ marcadas: number }> {
    const fecha = job.data.fecha || new Date().toISOString().split('T')[0];

    const result = await this.ds.query(`
      UPDATE facturas
      SET estado = 'vencida'
      WHERE fecha_vencimiento < $1
        AND estado IN ('emitida', 'pagada_parcial')
        AND deleted_at IS NULL
      RETURNING id
    `, [fecha]);

    const marcadas = result.length;

    if (marcadas > 0) {
      this.logger.log(`[VENCIDAS] ${marcadas} facturas marcadas como vencidas (${fecha})`);

      // Emitir evento
      this.events.emit('facturas.vencidas.marcadas', { fecha, marcadas });
    }

    return { marcadas };
  }

  // ────────────────────────────────────────────────────────────
  // JOB: GENERAR FACTURA INDIVIDUAL (para regenerar una sola)
  // ────────────────────────────────────────────────────────────
  @Process({ name: JOBS.GENERAR_FACTURA_CONTRATO, concurrency: 5 })
  async processGenerarFacturaIndividual(
    job: Job<PayloadGenerarFacturaContrato>,
  ): Promise<any> {
    const { contratoId, empresaId, mes, anio } = job.data;

    // Usar el servicio de facturación existente para una sola
    const userSistema = {
      sub: 'sistema', email: 'sistema@datafast.pe',
      empresaId, roles: ['Administrador'], permisos: [],
      nombreCompleto: 'Sistema', tema: 'dark',
    } as any;

    const resultado = await this.facturacionSvc.generarMensual(
      { mes, anio, contratoId },
      userSistema,
    );

    this.logger.log(
      `[FACTURA-INDIVIDUAL] Contrato ${contratoId}: ` +
      `${resultado.exitosas} generadas, ${resultado.omitidas} omitidas`,
    );

    return resultado;
  }

  // ────────────────────────────────────────────────────────────
  // HANDLERS DE COLA
  // ────────────────────────────────────────────────────────────

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(
      `[FACTURACION] ❌ Job ${job.name} #${job.id} ` +
      `(intento ${job.attemptsMade}): ${error.message}`,
      error.stack,
    );
  }

  @OnQueueCompleted()
  onCompleted(job: Job, result: any) {
    if (result?.errores > 0) {
      this.logger.warn(
        `[FACTURACION] ⚠️ Job ${job.name} completado con ${result.errores} errores`,
      );
    } else {
      this.logger.debug(`[FACTURACION] ✅ Job ${job.name} #${job.id} completado`);
    }
  }

  // ── Helpers ───────────────────────────────────────────────
  private ultimoDiaMes(anio: number, mes: number): string {
    const ultimo = new Date(anio, mes, 0).getDate();
    return `${anio}-${String(mes).padStart(2, '0')}-${ultimo}`;
  }

  private mesNombre(mes: number): string {
    const nombres = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio',
                     'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    return nombres[mes] || '';
  }
}
