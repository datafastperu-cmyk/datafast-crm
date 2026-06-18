import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
  MemoryHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { HealthService } from './health.service';
import { ModuleHealthService } from '../../common/services/module-health.service';

@ApiTags('Sistema')
@Controller()
export class HealthController {
  constructor(
    private readonly health:         HealthCheckService,
    private readonly db:             TypeOrmHealthIndicator,
    private readonly memory:         MemoryHealthIndicator,
    private readonly disk:           DiskHealthIndicator,
    private readonly healthService:  HealthService,
    private readonly moduleHealth:   ModuleHealthService,
  ) {}

  // ── GET /health — Health check completo (usado por Docker) ───
  @Get('health')
  @Public()
  @HealthCheck()
  @ApiOperation({ summary: 'Health check completo del sistema' })
  check() {
    return this.health.check([
      // PostgreSQL
      () => this.db.pingCheck('postgresql', { timeout: 3000 }),

      // Redis
      () => this.healthService.checkRedis(),

      // RAM — alerta si usa más de 500MB heap
      () => this.memory.checkHeap('memory_heap', 500 * 1024 * 1024),

      // RAM RSS — alerta si usa más de 750MB RSS
      () => this.memory.checkRSS('memory_rss', 750 * 1024 * 1024),

      // Disco — alerta si usa más del 90% del espacio
      () =>
        this.disk.checkStorage('disk', {
          thresholdPercent: 0.9,
          path: '/',
        }),
    ]);
  }

  // ── GET /health/live — Liveness probe (¿está vivo el proceso?) ─
  @Get('health/live')
  @Public()
  @ApiOperation({ summary: 'Liveness probe (Kubernetes)' })
  liveness() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      pid: process.pid,
    };
  }

  // ── GET /health/ready — Readiness probe (¿listo para tráfico?) ─
  @Get('health/ready')
  @Public()
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe (Kubernetes)' })
  readiness() {
    return this.health.check([
      () => this.db.pingCheck('postgresql', { timeout: 3000 }),
      () => this.healthService.checkRedis(),
    ]);
  }

  // ── GET /status — Estado detallado del sistema ───────────────
  @Get('status')
  @Public()
  @ApiOperation({ summary: 'Estado general del sistema (sin auth)' })
  async status() {
    const info = await this.healthService.getSystemInfo();
    return {
      success: true,
      app: 'CRM ISP DATAFAST',
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      timezone: process.env.TZ || 'America/Lima',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      ...info,
    };
  }

  // ── GET /health/modules — Estado de módulos auxiliares ────────
  @Get('health/modules')
  @Public()
  @ApiOperation({
    summary: 'Estado de módulos auxiliares',
    description:
      'Muestra el estado de cada módulo auxiliar (ok / degraded). ' +
      'Retorna HTTP 200 siempre — el sistema está operativo aunque algún módulo esté degradado. ' +
      'Un módulo degradado significa que esa funcionalidad está inactiva pero el core funciona.',
  })
  modulesStatus() {
    const registros  = this.moduleHealth.getEstados();
    const hayDeg     = this.moduleHealth.hayDegradados();

    const modulos: Record<string, unknown> = {};
    for (const r of registros) {
      modulos[r.modulo] = r.estado === 'ok'
        ? 'ok'
        : { estado: 'degraded', razon: r.razon ?? 'sin detalle', desde: r.desde };
    }

    return {
      success:   true,
      status:    hayDeg ? 'degraded' : 'ok',
      timestamp: new Date().toISOString(),
      modulos,
    };
  }
}
