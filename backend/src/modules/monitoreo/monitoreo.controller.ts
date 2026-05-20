import {
  Controller, Get, Post, Put, Patch, Delete,
  Body, Param, Query, ParseUUIDPipe,
  HttpCode, HttpStatus, SetMetadata, Logger,
} from '@nestjs/common';
import {
  ApiTags, ApiBearerAuth, ApiOperation,
  ApiResponse, ApiParam, ApiQuery,
} from '@nestjs/swagger';
import {
  IsString, IsIP, IsOptional, IsEnum, IsBoolean,
  IsNotEmpty, IsInt, Min, Max, MaxLength, IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import { InjectQueue } from '@nestjs/bull';
import { Queue }       from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository }       from 'typeorm';

import { AlertasService }    from './services/alertas.service';
import { PingService }       from './services/ping.service';
import { SnmpService }       from './services/snmp.service';
import { NodoDeviceService } from './services/nodo-device.service';
import { NetWatchService }   from './services/netwatch.service';
import { encrypt }           from '../../common/utils/encryption.util';
import { MonitoreoGateway }  from './gateways/monitoreo.gateway';
import { MikrotikService }   from '../mikrotik/mikrotik.service';
import { Public }            from '../../common/decorators/public.decorator';
import {
  Nodo, MedicionNodo, ConfiguracionAlerta,
  TipoNodo, MetricaAlerta, EstadoAlerta,
} from './entities/monitoreo.entity';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission, Roles } from '../../common/decorators/roles.decorator';
import { ApiResponse as StdResponse } from '../../common/dto/response.dto';
import { MONITOREO_QUEUE, JOB_PING_BATCH } from './monitoreo.worker';

// ── DTOs del controller ───────────────────────────────────────
class CreateNodoDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100) nombre: string;
  @ApiPropertyOptional() @IsOptional() @IsString() descripcion?: string;
  @ApiPropertyOptional({ enum: TipoNodo }) @IsOptional() @IsString() tipo?: string;
  @ApiPropertyOptional() @IsOptional() routerId?: string;
  @ApiPropertyOptional() @IsOptional() oltId?: string;
  @ApiProperty({ example: '192.168.100.1' }) @IsIP() ipMonitoreo: string;
  // ── Credenciales de equipo ────────────────────────────────
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) usuario?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() password?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) fabricante?: string;
  @ApiPropertyOptional({ default: 8728 }) @IsOptional() @IsInt() @Min(1) @Max(65535) @Type(() => Number) puertoApi?: number;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() usarSsl?: boolean;
  @ApiPropertyOptional({ default: 'snmp' }) @IsOptional() @IsString() @IsIn(['api', 'snmp', 'ssh']) metodoConexion?: string;
  // ── SNMP ──────────────────────────────────────────────────
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() snmpHabilitado?: boolean;
  @ApiPropertyOptional({ default: 'public' }) @IsOptional() @IsString() snmpCommunity?: string;
  @ApiPropertyOptional({ default: 2 }) @IsOptional() @IsInt() @Type(() => Number) snmpVersion?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Type(() => Number) snmpInterfaceIndex?: number;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() pingHabilitado?: boolean;
  @ApiPropertyOptional({ default: 60 }) @IsOptional() @IsInt() @Min(10) @Max(3600) @Type(() => Number) pingIntervaloSeg?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) latitud?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) longitud?: number;
}

class CreateConfigAlertaDto {
  @ApiPropertyOptional() @IsOptional() nodoId?: string;
  @ApiProperty({ enum: MetricaAlerta }) @IsEnum(MetricaAlerta) metrica: MetricaAlerta;
  @ApiProperty({ example: 80 }) @IsInt() @Min(0) @Type(() => Number) umbralWarning: number;
  @ApiProperty({ example: 95 }) @IsInt() @Min(0) @Type(() => Number) umbralCritical: number;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() notificarWhatsapp?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() telefonoDestino?: string;
}

@ApiTags('Monitoreo')
@ApiBearerAuth('JWT')
@Controller('monitoreo')
export class MonitoreoController {
  private readonly logger = new Logger(MonitoreoController.name);

  constructor(
    @InjectRepository(Nodo)               private readonly nodoRepo: Repository<Nodo>,
    @InjectRepository(MedicionNodo)       private readonly medicionRepo: Repository<MedicionNodo>,
    @InjectRepository(ConfiguracionAlerta) private readonly configRepo: Repository<ConfiguracionAlerta>,
    @InjectQueue(MONITOREO_QUEUE)         private readonly queue: Queue,
    private readonly alertasSvc:   AlertasService,
    private readonly pingSvc:      PingService,
    private readonly snmpSvc:      SnmpService,
    private readonly gateway:      MonitoreoGateway,
    private readonly deviceSvc:    NodoDeviceService,
    private readonly netWatchSvc:  NetWatchService,
    private readonly mikrotikSvc:  MikrotikService,
  ) {}

  // ─── NODOS ────────────────────────────────────────────────

  @Post('nodos')
  @RequirePermission('monitoring:manage')
  @ApiOperation({ summary: 'Registrar nodo/equipo para monitoreo' })
  async crearNodo(@Body() dto: CreateNodoDto, @CurrentUser() user: JwtPayload) {
    const { password, ...rest } = dto;
    const nodo = await this.nodoRepo.save(
      this.nodoRepo.create({
        ...(rest as any),
        passwordCifrado: password ? encrypt(password) : undefined,
        empresaId: user.empresaId,
      }),
    ) as Nodo;

    // Configurar NetWatch en el router asociado (async — no bloquea la respuesta)
    if (nodo.routerId) {
      this.mikrotikSvc.findOne(nodo.routerId, user.empresaId)
        .then((router) => this.netWatchSvc.configure(nodo, router))
        .catch((e) => this.logger.warn(`NetWatch setup: ${e.message}`));
    }

    return StdResponse.ok(nodo, 'Nodo registrado para monitoreo');
  }

  @Get('nodos')
  @RequirePermission('monitoring:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Listar nodos monitoreados con estado actual' })
  async listarNodos(@CurrentUser() user: JwtPayload) {
    const nodos = await this.nodoRepo.find({
      where: { empresaId: user.empresaId, activo: true },
      order: { tipo: 'ASC', nombre: 'ASC' },
    });
    return StdResponse.ok(nodos);
  }

  @Get('nodos/:id')
  @RequirePermission('monitoring:view')
  @SetMetadata('skipAudit', true)
  @ApiParam({ name: 'id' })
  async getNodo(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    const nodo = await this.nodoRepo.findOne({ where: { id, empresaId: user.empresaId } });
    if (!nodo) return StdResponse.ok(null, 'Nodo no encontrado');
    return StdResponse.ok(nodo);
  }

  @Put('nodos/:id')
  @RequirePermission('monitoring:manage')
  @ApiParam({ name: 'id' })
  async updateNodo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Partial<CreateNodoDto>,
    @CurrentUser() user: JwtPayload,
  ) {
    const { password, ...rest } = dto as CreateNodoDto;
    const update: any = { ...rest };
    if (password) update.passwordCifrado = encrypt(password);
    await this.nodoRepo.update({ id, empresaId: user.empresaId }, update);
    const nodo = await this.nodoRepo.findOne({ where: { id } });

    // Reconfigurar NetWatch si cambió la IP o el router asociado
    if (nodo?.routerId && (dto.ipMonitoreo || dto.routerId)) {
      this.mikrotikSvc.findOne(nodo.routerId, user.empresaId)
        .then((router) => this.netWatchSvc.configure(nodo, router))
        .catch((e) => this.logger.warn(`NetWatch reconfig: ${e.message}`));
    }

    return StdResponse.ok(nodo, 'Nodo actualizado');
  }

  // ── Test de conexión al equipo ────────────────────────────

  @Post('nodos/:id/test-conexion')
  @RequirePermission('monitoring:view')
  @HttpCode(HttpStatus.OK)
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Probar conexión al equipo (RouterOS API, SNMP o ping)' })
  @ApiParam({ name: 'id' })
  async testConexionNodo(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const nodo = await this.nodoRepo.findOne({ where: { id, empresaId: user.empresaId } });
    if (!nodo) return StdResponse.ok({ conectado: false }, 'Nodo no encontrado');
    const result = await this.deviceSvc.testConexion(nodo);
    return StdResponse.ok(result);
  }

  @Post('test-conexion')
  @RequirePermission('monitoring:view')
  @HttpCode(HttpStatus.OK)
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Probar conexión usando credenciales (sin necesidad de registrar el nodo)' })
  async testConexionRaw(
    @Body() body: {
      ip: string; usuario: string; password: string;
      fabricante: string; puertoApi?: number; usarSsl?: boolean;
      routerId?: string;
    },
    @CurrentUser() user: JwtPayload,
  ) {
    // Si hay router seleccionado: relay ping desde el router (sin necesidad de rutas directas)
    if (body.routerId) {
      const router = await this.mikrotikSvc.findOne(body.routerId, user.empresaId).catch(() => null);
      if (router) {
        const result = await this.deviceSvc.testConexionViaRouter(router, body.ip);
        return StdResponse.ok(result);
      }
    }

    const result = await this.deviceSvc.testConexionRaw({
      ip:         body.ip,
      usuario:    body.usuario,
      password:   body.password,
      fabricante: body.fabricante,
      puertoApi:  body.puertoApi  || 8728,
      usarSsl:    body.usarSsl    || false,
    });
    return StdResponse.ok(result);
  }

  // ─── WEBHOOK NETWATCH ─────────────────────────────────────
  // Endpoint público llamado por los routers MikroTik cuando un
  // equipo LAN cambia de estado. Autenticado por token en query param.

  @Get('webhook/netwatch')
  @Public()
  @HttpCode(HttpStatus.OK)
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Webhook NetWatch — llamado por MikroTik al cambiar estado de equipo' })
  async webhookNetwatch(
    @Query('token')   token:   string,
    @Query('nodoId')  nodoId:  string,
    @Query('estado')  estado:  string,
  ) {
    if (!this.netWatchSvc.verifyToken(token)) {
      return { ok: false };
    }

    const nodo = await this.nodoRepo.findOne({ where: { id: nodoId } });
    if (!nodo) return { ok: false };

    const ahora      = new Date();
    const nuevoEstado = estado === 'online' ? 'online' : 'offline';
    const cambio     = nodo.estado !== nuevoEstado;

    await this.nodoRepo.update(nodo.id, {
      estado:     nuevoEstado as any,
      ultimoPing: ahora,
      ...(cambio ? { estadoDesde: ahora } : {}),
    });

    if (cambio) {
      if (nuevoEstado === 'offline') {
        this.logger.warn(`🔴 NetWatch OFFLINE: ${nodo.nombre} (${nodo.ipMonitoreo})`);
        await this.alertasSvc.alertarNodoOffline(nodo.id, nodo.empresaId, nodo.nombre).catch(() => {});
      } else {
        this.logger.log(`🟢 NetWatch ONLINE: ${nodo.nombre} (${nodo.ipMonitoreo})`);
        await this.alertasSvc.alertarNodoOnline(nodo.id, nodo.empresaId, nodo.nombre).catch(() => {});
      }
    }

    this.gateway.broadcastMedicion(nodo.empresaId, {
      nodoId:     nodo.id,
      nodoNombre: nodo.nombre,
      estado:     nuevoEstado as any,
      latenciaMs: null,
      perdidaPct: nuevoEstado === 'offline' ? 100 : 0,
      timestamp:  ahora.toISOString(),
    });

    return { ok: true };
  }

  @Delete('nodos/:id')
  @RequirePermission('monitoring:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id' })
  async deleteNodo(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    const nodo = await this.nodoRepo.findOne({ where: { id, empresaId: user.empresaId } });
    await this.nodoRepo.update({ id, empresaId: user.empresaId }, { activo: false, deletedAt: new Date() });

    // Eliminar entrada NetWatch del router asociado (async)
    if (nodo?.routerId) {
      this.mikrotikSvc.findOne(nodo.routerId, user.empresaId)
        .then((router) => this.netWatchSvc.remove(nodo.id, router))
        .catch((e) => this.logger.warn(`NetWatch cleanup: ${e.message}`));
    }
  }

  // ─── PING MANUAL ─────────────────────────────────────────

  @Post('nodos/:id/ping')
  @RequirePermission('monitoring:view')
  @HttpCode(HttpStatus.OK)
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Ping manual inmediato a un nodo' })
  @ApiParam({ name: 'id' })
  async pingNodo(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    const nodo = await this.nodoRepo.findOne({ where: { id, empresaId: user.empresaId } });
    if (!nodo) return StdResponse.ok(null, 'Nodo no encontrado');

    const result = await this.pingSvc.ping(nodo.ipMonitoreo, 4, nodo.pingTimeoutMs || 3000);
    return StdResponse.ok(result);
  }

  @Post('ping')
  @RequirePermission('monitoring:view')
  @HttpCode(HttpStatus.OK)
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Ping inmediato a una IP (sin necesidad de tener el nodo registrado)' })
  async pingIp(@Body() body: { ip: string; count?: number }, @CurrentUser() user: JwtPayload) {
    const result = await this.pingSvc.ping(body.ip, body.count || 4, 5000);
    return StdResponse.ok(result);
  }

  // ─── HISTORIAL DE MEDICIONES ──────────────────────────────

  @Get('nodos/:id/mediciones')
  @RequirePermission('monitoring:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Historial de mediciones de un nodo' })
  @ApiParam({ name: 'id' })
  @ApiQuery({ name: 'horas', required: false, description: 'Últimas N horas (default: 24)' })
  async getMediciones(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('horas') horas: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const horasNum = Math.min(parseInt(horas || '24', 10), 168); // máx 7 días

    const mediciones = await this.medicionRepo
      .createQueryBuilder('m')
      .where('m.nodo_id = :id', { id })
      .andWhere('m.empresa_id = :empresaId', { empresaId: user.empresaId })
      .andWhere(`m.timestamp >= NOW() - INTERVAL '${horasNum} hours'`)
      .orderBy('m.timestamp', 'ASC')
      .getMany();

    return StdResponse.ok(mediciones);
  }

  // ─── SNMP ─────────────────────────────────────────────────

  @Get('nodos/:id/snmp/interfaces')
  @RequirePermission('monitoring:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Listar interfaces SNMP del nodo' })
  @ApiParam({ name: 'id' })
  async getSnmpInterfaces(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const nodo = await this.nodoRepo.findOne({ where: { id, empresaId: user.empresaId } });
    if (!nodo?.snmpHabilitado) return StdResponse.ok([], 'SNMP no habilitado en este nodo');

    const interfaces = await this.snmpSvc.getInterfaces(
      nodo.ipMonitoreo, nodo.snmpCommunity, nodo.snmpVersion,
    );
    return StdResponse.ok(interfaces);
  }

  @Get('nodos/:id/snmp/test')
  @RequirePermission('monitoring:view')
  @SetMetadata('skipAudit', true)
  @ApiParam({ name: 'id' })
  async testSnmp(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    const nodo = await this.nodoRepo.findOne({ where: { id, empresaId: user.empresaId } });
    if (!nodo) return StdResponse.ok({ conectado: false }, 'Nodo no encontrado');

    const conectado = await this.snmpSvc.testConnection(
      nodo.ipMonitoreo, nodo.snmpCommunity, nodo.snmpVersion,
    );
    return StdResponse.ok({ conectado, ip: nodo.ipMonitoreo, community: nodo.snmpCommunity });
  }

  // ─── DASHBOARD ────────────────────────────────────────────

  @Get('dashboard/trafico')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Historial de tráfico agregado por hora (últimas 24h)' })
  async getTrafico(@CurrentUser() user: JwtPayload) {
    const rows = await this.medicionRepo
      .createQueryBuilder('m')
      .select("TO_CHAR(DATE_TRUNC('hour', m.timestamp), 'HH24:MI')", 'hora')
      .addSelect("ROUND(COALESCE(AVG(m.trafico_rx_bps), 0) / 1000000.0, 2)", 'rx')
      .addSelect("ROUND(COALESCE(AVG(m.trafico_tx_bps), 0) / 1000000.0, 2)", 'tx')
      .where('m.empresa_id = :empresaId', { empresaId: user.empresaId })
      .andWhere("m.timestamp >= NOW() - INTERVAL '24 hours'")
      .groupBy("DATE_TRUNC('hour', m.timestamp)")
      .orderBy("DATE_TRUNC('hour', m.timestamp)", 'ASC')
      .getRawMany();
    return StdResponse.ok(rows);
  }

  @Get('dashboard')
  @RequirePermission('monitoring:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Resumen del dashboard de monitoreo' })
  async getDashboard(@CurrentUser() user: JwtPayload) {
    const [nodos, alertasResumen, colaStats] = await Promise.all([
      this.nodoRepo.find({ where: { empresaId: user.empresaId, activo: true } }),
      this.alertasSvc.getResumenAlertas(user.empresaId),
      this.queue.getJobCounts(),
    ]);

    const porEstado = nodos.reduce((acc, n) => {
      acc[n.estado] = (acc[n.estado] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const wsStats = this.gateway.getStats();

    return StdResponse.ok({
      nodos: { total: nodos.length, porEstado },
      alertas: alertasResumen,
      websocket: wsStats,
      cola: colaStats,
      timestamp: new Date().toISOString(),
    });
  }

  // ─── ALERTAS ──────────────────────────────────────────────

  @Get('alertas')
  @RequirePermission('monitoring:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Alertas activas de la empresa' })
  async getAlertas(@CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.alertasSvc.getAlertasActivas(user.empresaId));
  }

  @Get('alertas/historial')
  @RequirePermission('monitoring:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Historial de alertas' })
  @ApiQuery({ name: 'nodoId', required: false })
  async getHistorialAlertas(
    @Query('nodoId') nodoId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(
      await this.alertasSvc.getHistorialAlertas(user.empresaId, nodoId, 100),
    );
  }

  @Patch('alertas/:id/resolver')
  @RequirePermission('monitoring:manage')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Resolver alerta manualmente' })
  async resolverAlerta(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { motivo?: string },
    @CurrentUser() user: JwtPayload,
  ) {
    await this.alertasSvc.resolverAlerta(id, body.motivo || 'Resuelta manualmente', user.email);
    return StdResponse.ok(null, 'Alerta resuelta');
  }

  // ─── CONFIGURACIÓN DE ALERTAS ─────────────────────────────

  @Post('alertas/configuracion')
  @RequirePermission('monitoring:manage')
  @ApiOperation({ summary: 'Crear configuración de umbral de alerta' })
  async crearConfigAlerta(
    @Body() dto: CreateConfigAlertaDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const config = await this.configRepo.save(
      this.configRepo.create({ ...dto, empresaId: user.empresaId }),
    );
    return StdResponse.ok(config, 'Configuración de alerta creada');
  }

  @Get('alertas/configuracion')
  @RequirePermission('monitoring:view')
  @SetMetadata('skipAudit', true)
  async getConfigAlertas(@CurrentUser() user: JwtPayload) {
    const configs = await this.configRepo.find({
      where: { empresaId: user.empresaId, activo: true },
      order: { metrica: 'ASC' },
    });
    return StdResponse.ok(configs);
  }

  @Delete('alertas/configuracion/:id')
  @RequirePermission('monitoring:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id' })
  async deleteConfigAlerta(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.configRepo.update({ id, empresaId: user.empresaId }, { activo: false });
  }

  // ─── WEBSOCKET STATS ──────────────────────────────────────

  @Get('ws/stats')
  @RequirePermission('monitoring:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Estadísticas del WebSocket Gateway de monitoreo' })
  async getWsStats(@CurrentUser() user: JwtPayload) {
    return StdResponse.ok(this.gateway.getStats());
  }

  // ─── TRIGGER MANUAL DEL WORKER ───────────────────────────

  @Post('scan')
  @Roles('Administrador', 'Supervisor')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Forzar ciclo de monitoreo inmediato (sin esperar el cron)' })
  async forzarScan(@CurrentUser() user: JwtPayload) {
    const nodos = await this.nodoRepo.find({
      where: { empresaId: user.empresaId, activo: true, pingHabilitado: true },
    });

    await this.queue.add(JOB_PING_BATCH, {
      empresaId: user.empresaId,
      nodos: nodos.map((n) => ({
        id: n.id, ip: n.ipMonitoreo, nombre: n.nombre,
        tipo: n.tipo, pingTimeoutMs: n.pingTimeoutMs,
        pingReintentos: n.pingReintentos, estadoActual: n.estado,
        alertasHabilitadas: n.alertasHabilitadas,
      })),
    }, { priority: 1 });

    return StdResponse.ok({ encolados: nodos.length }, `${nodos.length} nodos encolados para scan inmediato`);
  }
}
