import {
  Process, Processor,
  OnQueueFailed, OnQueueCompleted,
} from '@nestjs/bull';
import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { InjectQueue }         from '@nestjs/bull';
import { CACHE_MANAGER }       from '@nestjs/cache-manager';
import { Cache }               from 'cache-manager';
import { Job, Queue }          from 'bull';
import { SchedulerRegistry }   from '@nestjs/schedule';
import { CronJob }             from 'cron';
import { filasUpdateReturning } from '../../common/utils/pg-result.util';
import { InjectDataSource }    from '@nestjs/typeorm';
import { DataSource }          from 'typeorm';
import { EventEmitter2 as EventEmitter } from '@nestjs/event-emitter';

import { FacturacionService }        from '../facturacion/facturacion.service';
import { DeudaPorContratoService } from '../facturacion/deuda-por-contrato.service';
import { ComprobantesConfigService } from '../facturacion/comprobantes-config.service';
import { GatewayMensajeriaService }  from '../notificaciones/services/gateway-mensajeria.service';
import { TipoNotificacion }          from '../notificaciones/services/whatsapp.service';
import { AuditoriaService }          from '../auth/auditoria.service';
import { EmpresaConfigService }      from '../config/empresa-config.service';

import {
  QUEUES, JOBS, JOB_OPTIONS,
  PayloadGenerarFacturasEmpresa,
  PayloadGenerarFacturaContrato,
} from './workers.constants';

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
export class FacturacionScheduler implements OnModuleInit {
  private readonly logger = new Logger(FacturacionScheduler.name);

  constructor(
    @InjectQueue(QUEUES.FACTURACION) private readonly queue: Queue,
    @InjectDataSource()              private readonly ds: DataSource,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly empresaConfig: EmpresaConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.RUN_CRONS !== 'true') return;
    const tz = await this.empresaConfig.getTimezone().catch(() => 'America/Lima');
    const job = new CronJob('* * * * *', () => this.scheduleFacturacionDiaria(), null, true, tz);
    this.schedulerRegistry.addCronJob('facturacion-diaria', job);
  }

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

    // ── 2. La generación automática ya NO se dispara desde aquí ──────────────
    //
    // H-10 (2026-08-09). Este cron encolaba una generación propia por
    // `servicios.dia_facturacion`, con su propio SQL y sus propias reglas de periodo,
    // elegibilidad y prorrateo. Era la SEGUNDA autoridad sobre la misma decisión de
    // negocio, y ese es el defecto: no que estuviera desincronizada, sino que podía estarlo.
    //
    // Ya había divergido dos veces —el tipo de comprobante (04/08) y todo el bloque del
    // dinero (08-09/08)—, y estuvo a punto de emitir un comprobante duplicado el 1 de
    // septiembre: calculaba el periodo como mes de calendario mientras el generador bueno
    // usa el ciclo del abonado, así que su comprobación de duplicados no encontraba nada.
    //
    // Quien factura ahora es `FacturacionService.generarFacturasDelDia`, encolado a diario
    // por `facturacion/facturacion.worker.ts`. Ese camino se escribió PRECISAMENTE porque
    // este estaba mal —su propio comentario lo dice: «con el disparo por dia_facturacion,
    // un cliente configurado para vencer el 28 se facturaba igual el día 1»— y se quedó
    // sin retirar. Esto no elige entre dos diseños: termina una migración a medias.
    //
    // Consecuencia sobre `servicios.dia_facturacion`: deja de DISPARAR la generación. No
    // queda inerte —eso se escribió aquí y era falso—: `PoliticaFacturacionService.resolver`
    // lo sigue usando como RESPALDO del día de pago cuando el abonado no tiene configuración
    // propia. Son dos papeles distintos y solo se retira el primero.
    //
    // Los dos servicios vivos lo tienen en 1 mientras su día de pago configurado es 28, así
    // que hoy no lo usa nadie: el respaldo solo entra si `facturacion_config` está vacía.
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
    private readonly deudaSvc:       DeudaPorContratoService,
    private readonly comprobantesSvc: ComprobantesConfigService,
  ) {}

  // ────────────────────────────────────────────────────────────
  // JOB: GENERAR FACTURAS DE UNA EMPRESA (disparo manual del operador)
  // ────────────────────────────────────────────────────────────
  //
  // H-10: aquí vivían ~320 líneas con SQL propio, su propio criterio de elegibilidad
  // (`estado = activo`, sin días entregados), su propio periodo (mes de calendario) y su
  // propia idempotencia. Todo eso se retiró: el worker ejecuta, no interpreta.
  //
  // Queda como punto de entrada operativo —el botón del operador sigue funcionando— pero
  // delega en la única autoridad, igual que `processGenerarFacturaIndividual` de abajo,
  // que ya lo hacía bien desde antes.
  @Process({ name: JOBS.GENERAR_FACTURAS_EMPRESA, concurrency: 2 })
  async processGenerarFacturasEmpresa(
    job: Job<PayloadGenerarFacturasEmpresa>,
  ): Promise<ResultadoGeneracion> {
    const { empresaId, mes, anio } = job.data;

    const userSistema = {
      sub: 'sistema', email: 'sistema@datafast.pe',
      empresaId, roles: ['Administrador'], permisos: [],
      nombreCompleto: 'Sistema', tema: 'dark',
    } as any;

    this.logger.log(`[FACTURACION] Empresa ${empresaId} | ${mes}/${anio} | manual`);

    // `forzar` NO se traslada: era una bandera de la implementación retirada que saltaba su
    // propia comprobación de duplicados. La autoridad única tiene la suya, y darle una puerta
    // para esquivarla sería devolverle al worker una regla propia por la puerta de atrás.
    const resultado = await this.facturacionSvc.generarMensual(
      { mes, anio },
      userSistema,
    );

    this.logger.log(
      `[FACTURACION] Empresa ${empresaId}: ${resultado.exitosas} generadas, ` +
      `${resultado.omitidas} omitidas, ${resultado.errores} errores`,
    );

    // El worker publica su propia forma de resultado (la cola y el panel la consumen);
    // el importe ya no lo calcula él, así que sale del propio resultado del servicio.
    return {
      empresaId, mes, anio,
      total:      resultado.total,
      exitosas:   resultado.exitosas,
      omitidas:   resultado.omitidas,
      errores:    resultado.errores,
      montoTotal: 0,
      detalles:   resultado.detalles.map((d) => ({
        contratoId: d.contratoId, resultado: d.resultado, error: d.error,
      })),
    };
  }
  // ────────────────────────────────────────────────────────────
  // JOB: MARCAR FACTURAS VENCIDAS (diario, antes de generar)
  // ────────────────────────────────────────────────────────────
  @Process({ name: JOBS.MARCAR_FACTURAS_VENCIDAS, concurrency: 1 })
  async processMarcarVencidas(job: Job<{ fecha: string }>): Promise<{ marcadas: number }> {
    const fecha = job.data.fecha || new Date().toISOString().split('T')[0];

    const result = filasUpdateReturning<{ id: string }>(await this.ds.query(`
      UPDATE facturas
      SET estado = 'vencida'
      WHERE fecha_vencimiento < $1
        AND estado IN ('emitida', 'pagada_parcial')
        AND deleted_at IS NULL
      RETURNING id
    `, [fecha]));

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
