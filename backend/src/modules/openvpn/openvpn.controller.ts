import {
  Controller, Get, Post, Put, Delete,
  Body, Param, Query, ParseIntPipe,
  HttpCode, HttpStatus, Res, DefaultValuePipe,
} from '@nestjs/common';
import { Response }       from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';

import { OpenvpnService }          from './openvpn.service';
import { CreateOpenvpnConfigDto, UpdateOpenvpnConfigDto } from './dto/openvpn.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission }       from '../../common/decorators/roles.decorator';
import { ApiResponse as StdResponse } from '../../common/dto/response.dto';

@ApiTags('OpenVPN')
@ApiBearerAuth('JWT')
@Controller('openvpn')
export class OpenvpnController {
  constructor(private readonly svc: OpenvpnService) {}

  // ── Config CRUD ──────────────────────────────────────────────

  @Get('config')
  @RequirePermission('mikrotik:view')
  @ApiOperation({ summary: 'Obtener configuración OpenVPN de la empresa' })
  async getConfig(@CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.svc.getConfig(user.empresaId));
  }

  @Post('config')
  @RequirePermission('mikrotik:manage')
  @ApiOperation({ summary: 'Crear o actualizar configuración OpenVPN' })
  async upsertConfig(
    @Body() dto: CreateOpenvpnConfigDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.upsertConfig(dto, user), 'Configuración guardada');
  }

  @Put('config')
  @RequirePermission('mikrotik:manage')
  @ApiOperation({ summary: 'Actualizar configuración OpenVPN' })
  async updateConfig(
    @Body() dto: UpdateOpenvpnConfigDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.upsertConfig(dto, user), 'Configuración actualizada');
  }

  @Delete('config')
  @RequirePermission('mikrotik:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar configuración OpenVPN' })
  async deleteConfig(@CurrentUser() user: JwtPayload): Promise<void> {
    await this.svc.deleteConfig(user.empresaId);
  }

  // ── Sincronizar certs desde filesystem → BD ─────────────────

  @Post('config/sync-certs')
  @RequirePermission('mikrotik:manage')
  @ApiOperation({ summary: 'Leer certs instalados en el servidor y guardarlos en BD' })
  async syncCerts(@CurrentUser() user: JwtPayload) {
    return StdResponse.ok(
      await this.svc.syncCertsFromFilesystem(user.empresaId),
      'Certificados sincronizados',
    );
  }

  // ── Estado del sistema VPN ───────────────────────────────────

  @Get('system/status')
  @RequirePermission('mikrotik:view')
  @ApiOperation({ summary: 'Estado actual del servidor OpenVPN (systemd, clientes conectados, PKI)' })
  async getSystemStatus() {
    return StdResponse.ok(await this.svc.getSystemStatus());
  }

  // ── Control del servicio ─────────────────────────────────────

  @Post('service/:action')
  @RequirePermission('mikrotik:manage')
  @ApiOperation({ summary: 'Controlar el servicio OpenVPN (start|stop|restart|reload)' })
  async controlService(@Param('action') action: string) {
    const allowed = ['start', 'stop', 'restart', 'reload'] as const;
    const result = await this.svc.controlService(action as any);
    return StdResponse.ok(result, result.ok ? `Servicio ${action} exitoso` : `Error en ${action}`);
  }

  // ── Clientes (certificados) ───────────────────────────────────

  @Get('clients')
  @RequirePermission('mikrotik:view')
  @ApiOperation({ summary: 'Listar certificados de clientes generados' })
  async listClients() {
    return StdResponse.ok(await this.svc.listClients());
  }

  @Post('clients/:nombre/generate')
  @RequirePermission('mikrotik:manage')
  @ApiOperation({ summary: 'Generar certificado de cliente y archivo .ovpn' })
  async generateClient(@Param('nombre') nombre: string) {
    const result = await this.svc.generateClientConfig(nombre);
    return StdResponse.ok({ name: result.name }, 'Certificado generado');
  }

  @Get('clients/:nombre/download')
  @RequirePermission('mikrotik:manage')
  @ApiOperation({ summary: 'Descargar archivo .ovpn del cliente' })
  async downloadClient(
    @Param('nombre') nombre: string,
    @Res() res: Response,
  ) {
    const content = await this.svc.getClientOvpnContent(nombre);
    res.setHeader('Content-Type', 'application/x-openvpn-profile');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}.ovpn"`);
    return res.send(content);
  }

  @Delete('clients/:nombre')
  @RequirePermission('mikrotik:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revocar certificado de cliente' })
  async revokeClient(@Param('nombre') nombre: string): Promise<void> {
    await this.svc.revokeClientCert(nombre);
  }

  // ── Logs ─────────────────────────────────────────────────────

  @Get('logs')
  @RequirePermission('mikrotik:view')
  @ApiQuery({ name: 'lines', required: false, type: Number, example: 100 })
  @ApiOperation({ summary: 'Obtener últimas líneas del log de OpenVPN' })
  async getLogs(
    @Query('lines', new DefaultValuePipe(100), ParseIntPipe) lines: number,
  ) {
    return StdResponse.ok({ logs: await this.svc.getServerLogs(lines) });
  }

  // ── Descargas de archivos de configuración ───────────────────

  @Get('config/download/server-conf')
  @RequirePermission('mikrotik:manage')
  @ApiOperation({ summary: 'Descargar server.conf generado desde la configuración en BD' })
  async downloadServerConf(
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const config = await this.svc.getConfig(user.empresaId);
    if (!config) return res.status(404).json({ message: 'No hay configuración OpenVPN' });

    const content = this.svc.generarServerConf(config);
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="server.conf"');
    return res.send(content);
  }

  @Get('config/download/instrucciones')
  @RequirePermission('mikrotik:manage')
  @ApiOperation({ summary: 'Descargar instrucciones de instalación del servidor VPN' })
  async downloadInstrucciones(
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const config = await this.svc.getConfig(user.empresaId);
    if (!config) return res.status(404).json({ message: 'No hay configuración OpenVPN' });

    const content = this.svc.generarInstrucciones(config);
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="instalacion-openvpn.sh"');
    return res.send(content);
  }

  @Get('config/cliente/:routerNombre')
  @RequirePermission('mikrotik:manage')
  @ApiOperation({ summary: 'Generar .ovpn de cliente inline (certs de BD)' })
  async generarClienteOvpn(
    @Param('routerNombre') routerNombre: string,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const config = await this.svc.getConfig(user.empresaId);
    if (!config) return res.status(404).json({ message: 'No hay configuración OpenVPN' });

    const content = this.svc.generarClienteOvpn(config, routerNombre);
    res.setHeader('Content-Type', 'application/x-openvpn-profile');
    res.setHeader('Content-Disposition', `attachment; filename="router-${routerNombre}.ovpn"`);
    return res.send(content);
  }
}
