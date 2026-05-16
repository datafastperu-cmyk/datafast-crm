import {
  Controller, Get, Post, Put, Delete,
  Body, Param, ParseUUIDPipe,
  HttpCode, HttpStatus, Res,
} from '@nestjs/common';
import { Response }       from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

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

  // ── Descargar server.conf ──────────────────────────────────
  @Get('config/download/server-conf')
  @RequirePermission('mikrotik:manage')
  @ApiOperation({ summary: 'Descargar el archivo server.conf para OpenVPN' })
  async downloadServerConf(
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const config = await this.svc.getConfig(user.empresaId);
    if (!config) {
      return res.status(404).json({ message: 'No hay configuración OpenVPN' });
    }
    const content = this.svc.generarServerConf(config);
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="server.conf"');
    return res.send(content);
  }

  // ── Descargar instrucciones de instalación ─────────────────
  @Get('config/download/instrucciones')
  @RequirePermission('mikrotik:manage')
  @ApiOperation({ summary: 'Descargar instrucciones de instalación del servidor VPN' })
  async downloadInstrucciones(
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const config = await this.svc.getConfig(user.empresaId);
    if (!config) {
      return res.status(404).json({ message: 'No hay configuración OpenVPN' });
    }
    const content = this.svc.generarInstrucciones(config);
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="instalacion-openvpn.sh"');
    return res.send(content);
  }

  // ── Generar .ovpn para un router específico ────────────────
  @Get('config/cliente/:routerNombre')
  @RequirePermission('mikrotik:manage')
  @ApiOperation({ summary: 'Generar archivo .ovpn de cliente para importar en MikroTik' })
  async generarClienteOvpn(
    @Param('routerNombre') routerNombre: string,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const config = await this.svc.getConfig(user.empresaId);
    if (!config) {
      return res.status(404).json({ message: 'No hay configuración OpenVPN' });
    }
    const content = this.svc.generarClienteOvpn(config, routerNombre);
    res.setHeader('Content-Type', 'application/x-openvpn-profile');
    res.setHeader('Content-Disposition', `attachment; filename="router-${routerNombre}.ovpn"`);
    return res.send(content);
  }
}
