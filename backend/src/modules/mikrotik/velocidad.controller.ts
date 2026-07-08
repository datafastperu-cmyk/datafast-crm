import {
  Controller, Post, Get, Patch, Body, Param,
  ParseUUIDPipe, HttpCode, HttpStatus, Query,
  SetMetadata, Logger,
} from '@nestjs/common';
import {
  ApiTags, ApiBearerAuth, ApiOperation,
  ApiResponse, ApiParam, ApiQuery,
} from '@nestjs/swagger';
import {
  IsString, IsUUID, IsInt, IsOptional,
  IsNotEmpty, Min, Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

import { VelocidadOrquestador }  from './services/velocidad/velocidad-orquestador.service';
import { VelocidadService }      from './services/velocidad/velocidad.service';
import { MikrotikService }       from './mikrotik.service';
import { VelocidadScheduler }    from './velocidad.worker';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission, Roles } from '../../common/decorators/roles.decorator';
import { ApiResponse as StdResponse } from '../../common/dto/response.dto';

// ─── DTOs del controller ──────────────────────────────────────
class AplicarVelocidadDto {
  @ApiProperty() @IsUUID()                      clienteId:    string;
  @ApiProperty() @IsString() @IsNotEmpty()      usuarioPppoe: string;
  @ApiProperty() @IsString() @IsNotEmpty()      ipAsignada:   string;
  @ApiProperty() @IsInt() @Min(1) @Type(() => Number) downloadMbps: number;
  @ApiProperty() @IsInt() @Min(1) @Type(() => Number) uploadMbps:   number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Type(() => Number) burstDownMbps?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Type(() => Number) burstUpMbps?:   number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Type(() => Number) burstTiempoSeg?: number;
  @ApiPropertyOptional({ default: 'simple_queue' }) @IsOptional() @IsString() tipoQueuePlan?: string;
  @ApiPropertyOptional({ default: 'residencial' })  @IsOptional() @IsString() tipoPlan?:      string;
  @ApiPropertyOptional() @IsOptional() @IsString() wanIface?: string;
}

class CambiarVelocidadDto {
  @ApiProperty() @IsUUID()                      clienteId:    string;
  @ApiProperty() @IsString() @IsNotEmpty()      usuarioPppoe: string;
  @ApiProperty() @IsInt() @Min(1) @Type(() => Number) downloadMbps: number;
  @ApiProperty() @IsInt() @Min(1) @Type(() => Number) uploadMbps:   number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(8) @Type(() => Number) prioridad?: number;
}

@ApiTags('Mikrotik - Velocidad')
@ApiBearerAuth('JWT')
@Controller('mikrotik/routers/:routerId/velocidad')
export class VelocidadController {
  private readonly logger = new Logger(VelocidadController.name);

  constructor(
    private readonly orquestador:  VelocidadOrquestador,
    private readonly velocidadSvc: VelocidadService,
    private readonly mikrotikSvc:  MikrotikService,
    private readonly scheduler:    VelocidadScheduler,
  ) {}

  // ── POST /velocidad/aplicar — Provisionar velocidad ────────
  @Post('aplicar')
  @RequirePermission('mikrotik:manage')
  @ApiOperation({
    summary: 'Aplicar control de velocidad para un cliente',
    description:
      'Detecta automáticamente la capacidad del router y aplica la estrategia ' +
      'óptima: Simple Queue, Queue Tree individual, o PCQ global.',
  })
  @ApiParam({ name: 'routerId' })
  async aplicar(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Body() dto: AplicarVelocidadDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const router = await this.mikrotikSvc.findOne(routerId, user.empresaId);
    const creds  = this.buildCreds(router);

    const resultado = await this.orquestador.aplicarVelocidad({
      routerCreds:   creds,
      clienteId:     dto.clienteId,
      usuarioPppoe:  dto.usuarioPppoe,
      ipAsignada:    dto.ipAsignada,
      downloadMbps:  dto.downloadMbps,
      uploadMbps:    dto.uploadMbps,
      burstDownMbps: dto.burstDownMbps,
      burstUpMbps:   dto.burstUpMbps,
      burstTiempoSeg: dto.burstTiempoSeg,
      tipoQueuePlan: dto.tipoQueuePlan || 'simple_queue',
      tipoPlan:      dto.tipoPlan      || 'residencial',
      wanIface:      dto.wanIface,
    });

    return StdResponse.ok(resultado, resultado.exitoso ? 'Velocidad aplicada' : 'Error al aplicar velocidad');
  }

  // ── PATCH /velocidad/cambiar — Cambiar velocidad en caliente ─
  @Patch('cambiar')
  @RequirePermission('mikrotik:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cambiar velocidad de un cliente sin desconectarlo',
    description:
      'Modifica max-limit en Queue Tree o Simple Queue existente. ' +
      'El cliente no pierde la conexión. ' +
      'También puede usarse para cambios de plan inmediatos.',
  })
  @ApiParam({ name: 'routerId' })
  async cambiar(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Body() dto: CambiarVelocidadDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const router = await this.mikrotikSvc.findOne(routerId, user.empresaId);
    const creds  = this.buildCreds(router);

    const resultado = await this.orquestador.cambiarVelocidadPlan(
      creds,
      dto.clienteId,
      dto.usuarioPppoe,
      dto.downloadMbps,
      dto.uploadMbps,
      dto.prioridad,
    );

    return StdResponse.ok(resultado, resultado.actualizado ? 'Velocidad actualizada' : resultado.detalle);
  }

  // ── GET /velocidad/capacidad — Capacidad del router ────────
  @Get('capacidad')
  @RequirePermission('mikrotik:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({
    summary: 'Detectar capacidad de queue del router',
    description: 'Verifica qué tipos de queue están disponibles: PCQ, Queue Tree, Simple Queue.',
  })
  @ApiParam({ name: 'routerId' })
  async getCapacidad(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const router = await this.mikrotikSvc.findOne(routerId, user.empresaId);
    const creds  = this.buildCreds(router);
    const cap    = await this.velocidadSvc.detectarCapacidad(creds);
    return StdResponse.ok(cap);
  }

  // ── POST /velocidad/sincronizar — Sincronización masiva ────
  @Post('sincronizar')
  @Roles('Administrador', 'Supervisor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sincronizar velocidades de todos los clientes del router',
    description:
      'Compara las queues en el router con los planes en la base de datos ' +
      'y corrige discrepancias. Puede tomar varios segundos.',
  })
  @ApiParam({ name: 'routerId' })
  async sincronizar(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const router = await this.mikrotikSvc.findOne(routerId, user.empresaId);
    const creds  = this.buildCreds(router);
    const resultado = await this.orquestador.sincronizarVelocidades(creds, routerId);
    return StdResponse.ok(
      resultado,
      `Sincronización: ${resultado.actualizados} actualizados, ${resultado.errores} errores`,
    );
  }

  // ── POST /velocidad/sincronizar/encolar — Job async ────────
  @Post('sincronizar/encolar')
  @Roles('Administrador')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Encolar sincronización asíncrona (Bull Job)',
    description: 'Encola la sincronización para ejecutarla en segundo plano sin bloquear la API.',
  })
  @ApiParam({ name: 'routerId' })
  async encolarSincronizacion(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const router = await this.mikrotikSvc.findOne(routerId, user.empresaId);
    await this.scheduler.enqueueVelocidadChange({
      routerId,
      empresaId:    user.empresaId,
      clienteId:    'sync-masivo',
      usuarioPppoe: 'sync',
      downloadMbps: 0,
      uploadMbps:   0,
    });
    return StdResponse.ok(null, 'Sincronización encolada — se ejecutará en segundo plano');
  }

  // ── GET /velocidad/discrepancias — Ver diferencias ────────
  @Get('discrepancias')
  @RequirePermission('mikrotik:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({
    summary: 'Listar discrepancias de velocidad sin corregirlas',
    description: 'Muestra qué clientes tienen una velocidad diferente a su plan, sin modificar nada.',
  })
  @ApiParam({ name: 'routerId' })
  async getDiscrepancias(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const router = await this.mikrotikSvc.findOne(routerId, user.empresaId);
    const creds  = this.buildCreds(router);

    // Obtener planes activos del router
    const contratos = await this.velocidadSvc['ds']?.query?.(`
      SELECT co.usuario_pppoe, pl.velocidad_bajada AS download_mbps, pl.velocidad_subida AS upload_mbps
      FROM contratos co JOIN planes pl ON pl.id = co.plan_id
      WHERE co.router_id = $1 AND co.estado IN ('activo','prorroga') AND co.deleted_at IS NULL
    `, [routerId]) || [];

    const planesPorQueue = new Map<string, { downloadMbps: number; uploadMbps: number }>(
      contratos.map((c: any) => [c.usuario_pppoe, {
        downloadMbps: c.download_mbps,
        uploadMbps:   c.upload_mbps,
      }]),
    );

    const discrepancias = await this.velocidadSvc.listarDiscrepancias(creds, planesPorQueue);
    return StdResponse.ok(discrepancias, `${discrepancias.length} discrepancias encontradas`);
  }

  // ── Helper: construir credenciales desde el router entity ─
  private buildCreds(router: any) {
    return {
      id:              router.id,
      ip:              router.ipGestion,
      port:            router.usarSsl ? router.puertoApiSsl : router.puertoApi,
      user:            router.usuario,
      passwordCifrado: router.passwordCifrado,
      useSsl:          router.usarSsl,
      timeoutSec:      router.timeoutConexion || 10,
      version:         'v7',
    };
  }
}
