import { Process, Processor, OnQueueFailed, OnQueueCompleted } from '@nestjs/bull';
import { Logger, Injectable, OnModuleInit } from '@nestjs/common';
import { Job } from 'bull';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { FacturacionService } from './facturacion.service';
import { EmpresaConfigService } from '../config/empresa-config.service';

export const FACTURACION_QUEUE = 'facturacion';

export interface GenerarMensualPayload {
  empresaId: string;
  usuarioId: string;
  mes:       number;
  anio:      number;
}

// ── Scheduler: encola los jobs en el momento correcto ────────
@Injectable()
export class FacturacionScheduler implements OnModuleInit {
  private readonly logger = new Logger(FacturacionScheduler.name);

  constructor(
    @InjectQueue(FACTURACION_QUEUE) private readonly queue: Queue,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly empresaConfig: EmpresaConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.RUN_CRONS !== 'true') return;
    const tz = await this.empresaConfig.getTimezone().catch(() => 'America/Lima');
    const job = new CronJob('5 0 * * *', () => this.scheduleDailyJobs(), null, true, tz);
    this.schedulerRegistry.addCronJob('facturacion-schedule-daily-jobs', job);
  }

  // Ejecutar CADA DÍA a las 00:05 en la zona horaria configurada en la empresa
  // → Genera facturas para empresas cuyo día de facturación es HOY
  // → Marca facturas vencidas
  async scheduleDailyJobs() {
    const hoy = new Date();
    this.logger.log(`Cron diario iniciado: ${hoy.toISOString()}`);

    // 1. Marcar facturas vencidas
    await this.queue.add('marcar-vencidas', {}, {
      attempts:  2,
      backoff:   { type: 'fixed', delay: 30_000 },
      removeOnComplete: true,
    });

    // 2. Generar facturas del día para empresas activas.
    //    Se encola TODOS los días: quién se factura hoy lo decide el ciclo de cada
    //    abonado (`diaPago − crearFactura` de su pestaña Facturación), no un día único
    //    para todo el parque. Con el disparo por `empresas.dia_facturacion`, un cliente
    //    configurado para vencer el 28 se facturaba igual el día 1.
    const empresas = await this.ds.query(`
      SELECT id FROM empresas
      WHERE estado = 'activo' AND deleted_at IS NULL
    `);

    const mes    = hoy.getMonth() + 1;
    const anio   = hoy.getFullYear();
    const diaHoy = hoy.getDate();
    let   delaySlot = 0;

    for (let i = 0; i < empresas.length; i++) {
      const emp = empresas[i];

      // El jobId lleva el día porque ahora hay una corrida por día: con el jobId mensual
      // anterior, Bull deduplicaba la del día 2 contra la del día 1 y no se emitía nada
      // el resto del mes.
      const jobId = `gen-dia-${emp.id}-${anio}-${String(mes).padStart(2, '0')}-${String(diaHoy).padStart(2, '0')}`;
      await this.queue.add('generar-mensual', {
        empresaId: emp.id,
        usuarioId: 'sistema',
        mes, anio,
      } as GenerarMensualPayload, {
        jobId,
        attempts:  3,
        backoff:   { type: 'exponential', delay: 60_000 },
        removeOnComplete: 100,
        removeOnFail:     500,
        delay: delaySlot++ * 1000,
      });
      this.logger.log(`Facturación del día encolada: empresa ${emp.id} | job: ${jobId}`);
    }
  }
}

// ── Processor: procesa los jobs de la cola ───────────────────
@Processor(FACTURACION_QUEUE)
export class FacturacionWorker {
  private readonly logger = new Logger(FacturacionWorker.name);

  constructor(
    private readonly facturacionSvc: FacturacionService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  // ── Job: marcar facturas vencidas ─────────────────────────
  @Process('marcar-vencidas')
  async processMarcarVencidas(job: Job) {
    this.logger.log('Procesando job: marcar-vencidas');
    const count = await this.facturacionSvc.marcarVencidas();
    this.logger.log(`Facturas vencidas marcadas: ${count}`);
    return { marcadas: count };
  }

  // ── Job: generación mensual de facturas ──────────────────
  @Process('generar-mensual')
  async processGenerarMensual(job: Job<GenerarMensualPayload>) {
    const { empresaId, mes, anio } = job.data;
    this.logger.log(`Procesando generación del día: empresa ${empresaId} | ${mes}/${anio}`);

    // Emite solo a los abonados cuyo ciclo cae hoy. El tipo de comprobante se resuelve
    // por jerarquía dentro del servicio (cliente → empresa default).
    const resultado = await this.facturacionSvc.generarFacturasDelDia(
      empresaId,
      new Date(),
    );

    this.logger.log(
      `Generación ${mes}/${anio} | empresa ${empresaId}: ` +
      `${resultado.exitosas} exitosas, ${resultado.omitidas} omitidas, ${resultado.errores} errores`,
    );

    // Reportar progreso si hay errores
    if (resultado.errores > 0) {
      const errDetails = resultado.detalles
        .filter(d => d.error)
        .map(d => `${d.numeroContrato}: ${d.error}`)
        .join('\n');
      this.logger.error(`Errores en generación:\n${errDetails}`);
    }

    return resultado;
  }

  // ── Handlers de eventos ───────────────────────────────────
  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(
      `Job ${job.name} #${job.id} falló (intento ${job.attemptsMade}): ${error.message}`,
      error.stack,
    );
  }

  @OnQueueCompleted()
  onCompleted(job: Job, result: any) {
    this.logger.debug(`Job ${job.name} #${job.id} completado`);
  }
}
