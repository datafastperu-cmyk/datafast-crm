import { Process, Processor, OnQueueFailed, OnQueueCompleted } from '@nestjs/bull';
import { Logger, Injectable } from '@nestjs/common';
import { Job } from 'bull';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { FacturacionService } from './facturacion.service';

export const FACTURACION_QUEUE = 'facturacion';

export interface GenerarMensualPayload {
  empresaId: string;
  usuarioId: string;
  mes:       number;
  anio:      number;
}

// ── Scheduler: encola los jobs en el momento correcto ────────
@Injectable()
export class FacturacionScheduler {
  private readonly logger = new Logger(FacturacionScheduler.name);

  constructor(
    @InjectQueue(FACTURACION_QUEUE) private readonly queue: Queue,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  // Ejecutar CADA DÍA a las 00:05 AM
  // → Genera facturas para empresas cuyo día de facturación es HOY
  // → Marca facturas vencidas
  @Cron('5 0 * * *', { timeZone: 'America/Lima' })
  async scheduleDailyJobs() {
    const hoy = new Date();
    this.logger.log(`Cron diario iniciado: ${hoy.toISOString()}`);

    // 1. Marcar facturas vencidas
    await this.queue.add('marcar-vencidas', {}, {
      attempts:  2,
      backoff:   { type: 'fixed', delay: 30_000 },
      removeOnComplete: true,
    });

    // 2. Generar facturas para empresas activas
    const empresas = await this.ds.query(`
      SELECT id, dia_facturacion FROM empresas
      WHERE estado = 'activo' AND deleted_at IS NULL
    `);

    const diaHoy = hoy.getDate();

    for (const emp of empresas) {
      if (parseInt(emp.dia_facturacion, 10) === diaHoy) {
        await this.queue.add('generar-mensual', {
          empresaId: emp.id,
          usuarioId: 'sistema',
          mes:       hoy.getMonth() + 1,
          anio:      hoy.getFullYear(),
        } as GenerarMensualPayload, {
          attempts:  3,
          backoff:   { type: 'exponential', delay: 60_000 },
          removeOnComplete: 100,
          removeOnFail:     500,
          // Delay de 1 segundo entre empresas para no saturar BD
          delay: empresas.indexOf(emp) * 1000,
        });
        this.logger.log(`Facturación mensual encolada: empresa ${emp.id}`);
      }
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
    const { empresaId, usuarioId, mes, anio } = job.data;
    this.logger.log(`Procesando generación mensual: empresa ${empresaId} | ${mes}/${anio}`);

    // Construir un user mock para el servicio (el sistema actúa como admin)
    const userSistema = {
      sub:           usuarioId,
      email:         'sistema@datafast.pe',
      empresaId,
      nombreCompleto: 'Sistema',
      roles:         ['Administrador'],
      permisos:      [],
      tema:          'dark',
    } as any;

    // El tipo de comprobante se resuelve automáticamente por jerarquía (cliente → empresa default)
    const resultado = await this.facturacionSvc.generarMensual(
      { mes, anio },
      userSistema,
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
