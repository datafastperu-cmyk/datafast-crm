import {
  Controller, Get, Post, Delete,
  Body, Param, Res, HttpCode, HttpStatus,
} from '@nestjs/common';
import { Response }       from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { VpnClienteService }     from './services/vpn-cliente.service';
import { CrearVpnClienteDto }    from './dto/vpn-cliente.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission }     from '../../common/decorators/roles.decorator';
import { Public }                from '../../common/decorators/public.decorator';
import { ApiResponse as StdResponse } from '../../common/dto/response.dto';

@ApiTags('VPN Clientes MikroTik')
@ApiBearerAuth('JWT')
@Controller('openvpn/mikrotik-clients')
export class VpnClienteController {
  constructor(private readonly svc: VpnClienteService) {}

  // ── Crear cliente VPN ─────────────────────────────────────────

  @Post()
  @RequirePermission('mikrotik:manage')
  @ApiOperation({ summary: 'Crear cliente VPN MikroTik — genera certificado PKI y script RouterOS' })
  async crear(
    @Body() dto:  CrearVpnClienteDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const { cliente, script } = await this.svc.crearCliente(dto, user);
    return StdResponse.ok({ cliente, script }, 'Cliente VPN creado');
  }

  // ── Listar clientes ───────────────────────────────────────────

  @Get()
  @RequirePermission('mikrotik:view')
  @ApiOperation({ summary: 'Listar clientes VPN MikroTik de la empresa' })
  async listar(@CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.svc.listar(user.empresaId));
  }

  // ── Obtener cliente ───────────────────────────────────────────

  @Get(':id')
  @RequirePermission('mikrotik:view')
  @ApiOperation({ summary: 'Obtener cliente VPN por ID' })
  async obtener(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.obtener(id, user.empresaId));
  }

  // ── Obtener script (regenera con token actualizado si expiró) ─

  @Get(':id/script')
  @RequirePermission('mikrotik:manage')
  @ApiOperation({ summary: 'Obtener script RouterOS para configurar el túnel' })
  async obtenerScript(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok({ script: await this.svc.obtenerScript(id, user.empresaId) });
  }

  // ── Validar túnel (polling del status.log) ────────────────────

  @Post(':id/validar')
  @RequirePermission('mikrotik:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validar si el router ya estableció el túnel VPN' })
  async validar(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.validarTunel(id, user.empresaId));
  }

  // ── Revocar certificado ───────────────────────────────────────

  @Delete(':id')
  @RequirePermission('mikrotik:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revocar certificado VPN del cliente' })
  async revocar(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    await this.svc.revocar(id, user.empresaId);
  }

  // ── Descargar certificado (público — protegido por token de 24h) ─
  // IMPORTANTE: Este endpoint es público, el token en la URL es la protección.
  // El MikroTik lo invoca con /tool fetch durante la ejecución del script.

  @Get('certs/:token/:filename')
  @Public()
  @ApiOperation({ summary: 'Descargar certificado PKI (token de un solo uso)' })
  async descargarCert(
    @Param('token')    token:    string,
    @Param('filename') filename: string,
    @Res()             res:      Response,
  ): Promise<void> {
    await this.svc.servirCertificado(token, filename, res);
  }
}
