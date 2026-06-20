import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { SagaLog, SagaStatus, SagaTipo, SagaPaso } from './entities/saga-log.entity';

@Injectable()
export class SagaLogService {
  private readonly logger = new Logger(SagaLogService.name);

  constructor(
    @InjectRepository(SagaLog)
    private readonly repo: Repository<SagaLog>,
  ) {}

  async iniciar(
    tipo: SagaTipo,
    contratoId: string,
    empresaId: string,
    actorId: string,
    pasosTotales: number,
    traceId?: string,
  ): Promise<string> {
    const saga = this.repo.create({
      sagaTipo:    tipo,
      contratoId,
      empresaId,
      actorId,
      traceId:     traceId ?? `trace-${Date.now()}`,
      status:      SagaStatus.RUNNING,
      pasoActual:  0,
      pasosTotales,
      pasos:       [],
    });
    const saved = await this.repo.save(saga);
    this.logger.log(`[Saga] INICIO ${tipo} | contrato=${contratoId} | id=${saved.id}`);
    return saved.id;
  }

  async registrarPaso(
    sagaId: string,
    paso: number,
    nombre: string,
    resultado: 'OK' | 'FAIL' | 'SKIPPED',
    error?: string,
    duracionMs?: number,
  ): Promise<void> {
    const saga = await this.repo.findOne({ where: { id: sagaId } });
    if (!saga) return;

    const nuevoPaso: SagaPaso = {
      paso, nombre, resultado, error, duracionMs,
      ejecutadoEn: new Date().toISOString(),
    };

    await this.repo.update(sagaId, {
      pasoActual: paso,
      pasos:      [...(saga.pasos ?? []), nuevoPaso],
    });

    if (resultado === 'FAIL') {
      this.logger.warn(`[Saga] PASO FAIL ${saga.sagaTipo} paso=${paso} nombre=${nombre} | ${error}`);
    }
  }

  async completar(sagaId: string): Promise<void> {
    await this.repo.update(sagaId, {
      status:       SagaStatus.COMPLETED,
      completadoEn: new Date(),
    });
    this.logger.log(`[Saga] COMPLETADA id=${sagaId}`);
  }

  async fallar(sagaId: string, error: string): Promise<void> {
    await this.repo.update(sagaId, {
      status:       SagaStatus.FAILED,
      error:        error.slice(0, 2000),
      completadoEn: new Date(),
    });
    this.logger.error(`[Saga] FALLIDA id=${sagaId} | ${error}`);
  }

  async iniciarCompensacion(sagaId: string): Promise<void> {
    await this.repo.update(sagaId, { status: SagaStatus.COMPENSATING });
    this.logger.warn(`[Saga] COMPENSANDO id=${sagaId}`);
  }

  async falloCompensacion(sagaId: string, error: string): Promise<void> {
    await this.repo.update(sagaId, {
      status:       SagaStatus.COMPENSATION_FAILED,
      error:        error.slice(0, 2000),
      completadoEn: new Date(),
    });
    this.logger.error(`[Saga] COMPENSACION FALLIDA id=${sagaId} — requiere intervención manual | ${error}`);
  }

  // Sagas RUNNING por más de N minutos: proceso muerto mid-saga
  async findStaleRunning(timeoutMinutes = 10): Promise<SagaLog[]> {
    const limite = new Date(Date.now() - timeoutMinutes * 60 * 1000);
    return this.repo.find({
      where: { status: SagaStatus.RUNNING, iniciadoEn: LessThan(limite) },
      order: { iniciadoEn: 'ASC' },
      take: 50,
    });
  }

  // Sagas COMPENSATION_FAILED: requieren intervención manual
  async findCompensationFailed(): Promise<SagaLog[]> {
    return this.repo.find({
      where: { status: SagaStatus.COMPENSATION_FAILED },
      order: { iniciadoEn: 'DESC' },
      take: 100,
    });
  }
}
