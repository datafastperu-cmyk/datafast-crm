import {
  Controller, Get, Post, Body, Query,
  HttpCode, HttpStatus, Logger,
} from '@nestjs/common';
import {
  ApiTags, ApiBearerAuth, ApiOperation, ApiQuery,
} from '@nestjs/swagger';
import { InjectQueue }   from '@nestjs/bull';
import { Queue }         from 'bull';
import {
  IsOptional, IsInt, IsBoolean, IsUUID, Min, Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

import { CobranzaScheduler }    from './cobranza.worker';
import { FacturacionScheduler } from './facturacion.worker';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { Roles }                from '../../common/decorators/roles.decorator';
import { ApiResponse }          from '../../common/dto/response.dto';
import { QUEUES }               from './workers.constants';

class TriggerFacturacionDto {
  @ApiPropertyOptional({ example: 1 }) @IsOptional() @IsInt() @Min(1) @Max(12) @Type(() => Number)
  mes?: number;
  @ApiPropertyOptional({ example: 2024 }) @IsOptional() @IsInt() @Type(() => Number)
  anio?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  forzar?: boolean;
}

class TriggerCobranzaDto {
  @ApiPropertyOptional({ example: 5 }) @IsOptional() @IsInt() @Min(0) @Type(() => Number)
  diasGracia?: number;
}

@ApiTags('Workers — Admin')
@ApiBearerAuth('JWT')
@Roles('Administrador')
@Controller('admin/workers')
export class WorkersController {
  private readonly logger = new Logger(WorkersController.name);

  constructor(
    @InjectQueue(QUEUES.COBRANZA)    private readonly cobranzaQueue:    Queue,
    @InjectQueue(QUEUES.FACTURACION) private readonly facturacionQueue:  Queue,
    private readonly cobranzaSched:  CobranzaScheduler,
    private readonly facturacionSched: FacturacionScheduler,
  ) {}

  // ── GET /admin/workers/status ─────────────────────────────
  @Get('status')
  @ApiOperation({
    summary: 'Estado de todas las colas Bull',
    description: 'Jobs en espera, activos, completados y fallidos por cola.',
  })
  async getStatus() {
    const [cobranza, facturacion] = await Promise.all([
      this.cobranzaQueue.getJobCounts(),
      this.facturacionQueue.getJobCounts(),
    ]);

    return ApiResponse.ok({
      cobranza:    { ...cobranza, nombre: QUEUES.COBRANZA },
      facturacion: { ...facturacion, nombre: QUEUES.FACTURACION },
      timestamp:   new Date().toISOString(),
    });
  }

  // ── GET /admin/workers/jobs ────────────────────────────────
  @Get('jobs')
  @ApiOperation({ summary: 'Jobs recientes por cola y estado' })
  @ApiQuery({ name: 'cola', required: false, enum: ['cobranza', 'facturacion'] })
  @ApiQuery({ name: 'estado', required: false, enum: ['active', 'waiting', 'failed', 'completed'] })
  async getJobs(
    @Query('cola') cola: string,
    @Query('estado') estado: string,
  ) {
    const queue   = cola === 'facturacion' ? this.facturacionQueue : this.cobranzaQueue;
    const limit   = 20;
    let jobs: any[] = [];

    switch (estado) {
      case 'active':    jobs = await queue.getActive(0, limit);    break;
      case 'waiting':   jobs = await queue.getWaiting(0, limit);   break;
      case 'failed':    jobs = await queue.getFailed(0, limit);     break;
      case 'completed': jobs = await queue.getCompleted(0, limit);  break;
      default:
        jobs = [
          ...(await queue.getActive(0, 5)),
          ...(await queue.getWaiting(0, 5)),
          ...(await queue.getFailed(0, 5)),
        ];
    }

    return ApiResponse.ok(jobs.map((j) => ({
      id:          j.id,
      name:        j.name,
      state:       j.data ? 'pending' : 'unknown',
      data:        j.data,
      progress:    j.progress(),
      attemptsMade: j.attemptsMade,
      timestamp:   j.timestamp,
      processedOn: j.processedOn,
      finishedOn:  j.finishedOn,
      failedReason: j.failedReason,
    })));
  }

  // ── POST /admin/workers/facturacion/trigger ───────────────
  @Post('facturacion/trigger')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Disparar generación masiva de facturas manualmente',
    description:
      'Encola la generación de facturas para la empresa actual (o todas si es superadmin). ' +
      'Útil para regenerar facturas de un mes específico.',
  })
  async triggerFacturacion(
    @Body() dto: TriggerFacturacionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const hoy  = new Date();
    const mes  = dto.mes  || hoy.getMonth() + 1;
    const anio = dto.anio || hoy.getFullYear();

    const jobId = await this.facturacionSched.enqueueGeneracionManual(
      user.empresaId, mes, anio, dto.forzar || false,
    );

    this.logger.log(
      `[TRIGGER] Facturación ${mes}/${anio} encolada por ${user.email} | Job: ${jobId}`,
    );

    return ApiResponse.ok(
      { jobId, mes, anio, empresaId: user.empresaId },
      `Generación de facturas ${mes}/${anio} encolada (job #${jobId})`,
    );
  }

  // ── POST /admin/workers/cobranza/trigger ──────────────────
  @Post('cobranza/trigger')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Disparar detección de morosos manualmente',
    description:
      'Ejecuta el proceso de detección de contratos morosos inmediatamente. ' +
      'Normalmente se ejecuta automáticamente a las 06:00 AM.',
  })
  async triggerCobranza(@CurrentUser() user: JwtPayload) {
    await this.cobranzaSched.detectarMorosos();

    this.logger.log(`[TRIGGER] Detección de morosos lanzada por ${user.email}`);

    return ApiResponse.ok(null, 'Detección de morosos iniciada — revisa la cola de cobranza');
  }

  // ── POST /admin/workers/clean ─────────────────────────────
  @Post('clean')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Limpiar jobs completados y fallidos de las colas',
    description: 'Elimina los jobs completados y fallidos de todas las colas Bull.',
  })
  async cleanQueues(@CurrentUser() user: JwtPayload) {
    await Promise.all([
      this.cobranzaQueue.clean(0, 'completed'),
      this.cobranzaQueue.clean(0, 'failed'),
      this.facturacionQueue.clean(0, 'completed'),
      this.facturacionQueue.clean(0, 'failed'),
    ]);

    this.logger.log(`[CLEAN] Colas limpiadas por ${user.email}`);

    return ApiResponse.ok(null, 'Colas limpiadas correctamente');
  }

  // ── POST /admin/workers/retry-failed ─────────────────────
  @Post('retry-failed')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Re-encolar todos los jobs fallidos',
    description: 'Mueve los jobs fallidos de vuelta a la cola de espera.',
  })
  async retryFailed(@Query('cola') cola: string, @CurrentUser() user: JwtPayload) {
    const queue = cola === 'facturacion' ? this.facturacionQueue : this.cobranzaQueue;
    const failed = await queue.getFailed(0, 100);

    let reintentados = 0;
    for (const job of failed) {
      await job.retry();
      reintentados++;
    }

    this.logger.log(
      `[RETRY] ${reintentados} jobs fallidos reencolados en ${cola || 'cobranza'} por ${user.email}`,
    );

    return ApiResponse.ok({ reintentados }, `${reintentados} jobs reencolados`);
  }
}
