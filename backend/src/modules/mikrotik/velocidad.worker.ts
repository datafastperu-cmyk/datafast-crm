import { Process, Processor, OnQueueFailed, OnQueueCompleted } from '@nestjs/bull';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue }            from '@nestjs/bull';
import { SchedulerRegistry }      from '@nestjs/schedule';
import { CronJob }                from 'cron';
import { Job, Queue }             from 'bull';
import { InjectRepository }       from '@nestjs/typeorm';
import { Repository }             from 'typeorm';
import { InjectDataSource }       from '@nestjs/typeorm';
import { DataSource }             from 'typeorm';
import { VelocidadOrquestador }   from './services/velocidad/velocidad-orquestador.service';
import { Router, EstadoEquipo, VersionRouterOS } from './entities/router.entity';
import { RouterConnectionPool }   from './services/connection-pool.service';
import { EmpresaConfigService }   from '../config/empresa-config.service';

export const VELOCIDAD_QUEUE = 'velocidad-sync';

export interface SyncVelocidadPayload {
  routerId:   string;
  empresaId:  string;
}

export interface CambioVelocidadPayload {
  routerId:     string;
  empresaId:    string;
  clienteId:    string;
  usuarioPppoe: string;
  downloadMbps: number;
  uploadMbps:   number;
  prioridad?:   number;
}

// ── Scheduler ─────────────────────────────────────────────────
@Injectable()
export class VelocidadScheduler implements OnModuleInit {
  private readonly logger = new Logger(VelocidadScheduler.name);

  constructor(
    @InjectQueue(VELOCIDAD_QUEUE) private readonly queue: Queue,
    @InjectRepository(Router)    private readonly routerRepo: Repository<Router>,
    @InjectDataSource()          private readonly ds: DataSource,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly empresaConfig: EmpresaConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const tz = await this.empresaConfig.getTimezone().catch(() => 'America/Lima');
    const job = new CronJob('0 */4 * * *', () => this.scheduleSync(), null, true, tz);
    this.schedulerRegistry.addCronJob('velocidad-schedule-sync', job);
  }

  // Sincronizar velocidades cada 4 horas
  async scheduleSync(): Promise<void> {
    this.logger.log('Iniciando sincronización periódica de velocidades');

    // Obtener todos los routers activos y online
    const routers = await this.routerRepo.find({
      where: { activo: true, estado: EstadoEquipo.ONLINE, deletedAt: null as any },
    });

    for (const router of routers) {
      // Encolar con delay escalonado para no saturar
      await this.queue.add(
        'sincronizar-router',
        { routerId: router.id, empresaId: router.empresaId } as SyncVelocidadPayload,
        {
          delay:    routers.indexOf(router) * 30_000, // 30s entre routers
          attempts: 2,
          backoff:  { type: 'fixed', delay: 60_000 },
          removeOnComplete: true,
        },
      );
    }

    this.logger.log(`${routers.length} routers encolados para sincronización`);
  }

  // Job inmediato para cambio de plan (se encola desde el servicio de contratos)
  async enqueueVelocidadChange(payload: CambioVelocidadPayload): Promise<void> {
    await this.queue.add('cambiar-velocidad', payload, {
      priority: 1,      // Alta prioridad
      attempts: 3,
      backoff:  { type: 'exponential', delay: 10_000 },
      removeOnComplete: true,
    });
    this.logger.log(
      `Cambio de velocidad encolado: cliente ${payload.clienteId} | ` +
      `${payload.downloadMbps}/${payload.uploadMbps} Mbps`,
    );
  }
}

// ── Processor ─────────────────────────────────────────────────
@Processor(VELOCIDAD_QUEUE)
export class VelocidadWorker {
  private readonly logger = new Logger(VelocidadWorker.name);

  constructor(
    private readonly orquestador: VelocidadOrquestador,
    private readonly pool:        RouterConnectionPool,
    @InjectRepository(Router)     private readonly routerRepo: Repository<Router>,
  ) {}

  // ── Job: Sincronizar velocidades de un router ─────────────
  @Process('sincronizar-router')
  async processSincronizarRouter(job: Job<SyncVelocidadPayload>) {
    const { routerId, empresaId } = job.data;
    this.logger.log(`Sincronizando velocidades: router ${routerId}`);

    const router = await this.routerRepo.findOne({
      where: { id: routerId, activo: true, deletedAt: null as any },
    });

    if (!router) {
      this.logger.warn(`Router ${routerId} no encontrado o inactivo`);
      return { omitido: true };
    }

    const creds = {
      id:              router.id,
      ip:              router.ipGestion,
      port:            router.usarSsl ? router.puertoApiSsl : router.puertoApi,
      user:            router.usuario,
      passwordCifrado: router.passwordCifrado,
      useSsl:          router.usarSsl,
      timeoutSec:      router.timeoutConexion || 10,
      version:         'v7',
    };

    const resultado = await this.orquestador.sincronizarVelocidades(creds, routerId);

    // Reportar progreso al job
    await job.progress(100);

    this.logger.log(
      `Sincronización ${routerId}: ` +
      `${resultado.actualizados} actualizados, ${resultado.errores} errores`,
    );

    return resultado;
  }

  // ── Job: Cambiar velocidad de un cliente específico ───────
  @Process('cambiar-velocidad')
  async processCambiarVelocidad(job: Job<CambioVelocidadPayload>) {
    const { routerId, clienteId, usuarioPppoe, downloadMbps, uploadMbps, prioridad } = job.data;

    this.logger.log(
      `Aplicando cambio de velocidad: cliente ${clienteId} → ` +
      `${downloadMbps}/${uploadMbps} Mbps en router ${routerId}`,
    );

    const router = await this.routerRepo.findOne({
      where: { id: routerId, activo: true, deletedAt: null as any },
    });

    if (!router) {
      this.logger.warn(`Router ${routerId} no disponible para cambio de velocidad`);
      return { omitido: true };
    }

    const creds = {
      id:              router.id,
      ip:              router.ipGestion,
      port:            router.usarSsl ? router.puertoApiSsl : router.puertoApi,
      user:            router.usuario,
      passwordCifrado: router.passwordCifrado,
      useSsl:          router.usarSsl,
      timeoutSec:      router.timeoutConexion || 10,
      version:         'v7',
    };

    const resultado = await this.orquestador.cambiarVelocidadPlan(
      creds, clienteId, usuarioPppoe, downloadMbps, uploadMbps, prioridad,
    );

    await job.progress(100);

    this.logger.log(
      `Cambio de velocidad ${clienteId}: ` +
      `${resultado.actualizado ? 'exitoso' : 'fallido'} | ${resultado.detalle}`,
    );

    return resultado;
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(
      `Job ${job.name} #${job.id} falló (intento ${job.attemptsMade}): ${error.message}`,
    );
  }

  @OnQueueCompleted()
  onCompleted(job: Job) {
    this.logger.debug(`Job ${job.name} #${job.id} completado`);
  }
}
