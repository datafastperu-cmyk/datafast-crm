import { Controller, Get, Post, Put, Body, Param, Query, Req, ParseUUIDPipe, SetMetadata, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam } from '@nestjs/swagger';
import { Request } from 'express';
import { XuiApiService } from './xui-api.service';
import { XuiLinesService } from './xui-lines.service';
import { XuiMonitorService } from './xui-monitor.service';
import { XuiServidoresService } from './xui-servidores.service';
import { EditarXuiLineDto, FilterXuiLineDto } from './dto/xui-line.dto';
import { CrearXuiServidorDto, EditarXuiServidorDto, ProbarXuiServidorDto } from './dto/xui-servidor.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/roles.decorator';
import { ApiResponse as StdResponse } from '../../common/dto/response.dto';

@ApiTags('IPTV — XUI ONE')
@ApiBearerAuth('JWT')
@Controller('xui')
export class XuiController {
  constructor(
    private readonly xuiApi:     XuiApiService,
    private readonly lines:      XuiLinesService,
    private readonly monitor:    XuiMonitorService,
    private readonly servidores: XuiServidoresService,
  ) {}

  // ─── SERVIDOR (una sola fila por empresa) ─────────────────────

  @Get('servidor')
  @RequirePermission('system:config')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Obtener la configuración del servidor XUI ONE (o null si no existe)' })
  async obtenerServidor(@CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.servidores.obtener(user.empresaId));
  }

  @Post('servidor/probar')
  @RequirePermission('system:config')
  @ApiOperation({ summary: 'Probar conexión con una URL/API key candidata, sin guardar' })
  async probarServidor(@Body() dto: ProbarXuiServidorDto) {
    return StdResponse.ok(await this.servidores.probar(dto));
  }

  @Post('servidor')
  @RequirePermission('system:config')
  @ApiOperation({ summary: 'Registrar el servidor XUI ONE (solo si no existe uno ya configurado)' })
  async crearServidor(
    @Body() dto: CrearXuiServidorDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    return StdResponse.ok(await this.servidores.crear(dto, user, req), 'Servidor XUI ONE configurado');
  }

  @Put('servidor/:id')
  @RequirePermission('system:config')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Editar la configuración del servidor XUI ONE' })
  async editarServidor(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarXuiServidorDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    return StdResponse.ok(await this.servidores.editar(id, dto, user, req), 'Servidor XUI ONE actualizado');
  }

  @Post('servidor/:id/sincronizar')
  @RequirePermission('system:config')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Refrescar totales de catálogo (bouquets/canales/lines) sin reingresar credenciales' })
  async sincronizarServidor(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.servidores.sincronizar(id, user.empresaId), 'Catálogo sincronizado');
  }

  @Get('health')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Verificar conectividad con XUI ONE' })
  async health() {
    return StdResponse.ok(await this.xuiApi.verificarConectividad());
  }

  @Get('bouquets')
  @RequirePermission('clientes:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Catálogo de bouquets en vivo desde XUI ONE' })
  async bouquets() {
    return StdResponse.ok(await this.xuiApi.listarBouquets());
  }

  @Get('lines')
  @RequirePermission('clientes:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Listar lines IPTV (por cliente, por contrato o texto)' })
  async listar(@Query() filtros: FilterXuiLineDto, @CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.lines.listar(user.empresaId, filtros));
  }

  // Sin DELETE expuesto — la baja de un line es siempre automática,
  // disparada por el cambio de plan del contrato dueño (ver contratos.service.ts).
  @Put('lines/:id')
  @RequirePermission('clientes:edit')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Editar bouquets, máx. conexiones o regenerar credenciales de un line' })
  async editar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarXuiLineDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.lines.editarLine(id, user.empresaId, dto), 'Line IPTV actualizado');
  }

  @Get('channels/status')
  @RequirePermission('clientes:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Estado online/offline de canales (snapshot cacheado por el poller)' })
  async canales() {
    return StdResponse.ok(this.monitor.getChannelsSnapshot());
  }
}
