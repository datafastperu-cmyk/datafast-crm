import {
  Controller, Get, Post, Delete,
  Body, Param, Res, HttpCode, HttpStatus,
  UnauthorizedException, ForbiddenException, Req,
} from '@nestjs/common';
import { Response, Request } from 'express';
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

  // ── Obtener script de configuración por router ───────────────

  @Get('by-router/:routerId/script')
  @RequirePermission('mikrotik:manage')
  @ApiOperation({ summary: 'Obtener script RouterOS para el cliente VPN vinculado a un router' })
  async getScriptByRouter(
    @Param('routerId') routerId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const script = await this.svc.getScriptByRouterId(routerId, user.empresaId);
    return StdResponse.ok({ script }, 'Script generado');
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

  // ── Revocar cliente VPN (wizard cancelado / registro interrumpido) ────────

  @Delete(':id')
  @RequirePermission('mikrotik:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revocar cliente VPN (cancela certificado y elimina registro)' })
  async revocar(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.svc.revocar(id, user.empresaId);
    return StdResponse.ok(null, 'Cliente VPN revocado');
  }

  // ── Limpiar túneles huérfanos ─────────────────────────────────

  @Post('limpiar-huerfanos')
  @RequirePermission('mikrotik:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revocar clientes VPN cuyo router fue eliminado o nunca registrado' })
  async limpiarHuerfanos(@CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.svc.limpiarHuerfanos(user.empresaId), 'Limpieza completada');
  }

  // ── Revocar por tokenDescarga (sin JWT — sesión expirada / crash del browser) ─

  @Post('revoke-by-token')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revocar cliente VPN por tokenDescarga (sin autenticación JWT)' })
  async revocarPorToken(@Body() body: { tokenDescarga: string }) {
    if (!body?.tokenDescarga) return StdResponse.ok(null, 'Sin token');
    await this.svc.revocarPorToken(body.tokenDescarga);
    return StdResponse.ok(null, 'Revocado');
  }

  // ── Verificar credenciales VPN (llamado por vpn-auth.sh en el servidor) ─
  // Endpoint público — protegido solo por red interna (llamado solo desde localhost)

  @Post('verify-auth')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verificar credenciales VPN (uso interno — solo localhost)' })
  async verifyAuth(
    @Body() body: { username: string; password: string },
    @Req()  req:  Request,
  ) {
    const ip = req.socket.remoteAddress ?? '';
    if (!ip.includes('127.0.0.1') && !ip.includes('::1')) {
      throw new ForbiddenException('Solo accesible desde localhost');
    }
    const ok = await this.svc.verifyAuth(body.username ?? '', body.password ?? '');
    if (!ok) throw new UnauthorizedException('Credenciales inválidas');
    return StdResponse.ok(null, 'Autenticado');
  }

  // ── Verificar sesión CN antes de permitir nueva conexión (client-connect) ─
  // Mata sesión impostora si la sesión existente no responde a la API del router.
  @Post('verificar-sesion-cn')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verificar sesión activa por CN y matar impostora si aplica (solo localhost)' })
  async verificarSesionCn(
    @Body() body: { cn: string; ipNueva?: string },
    @Req()  req:  Request,
  ) {
    const ip = req.socket.remoteAddress ?? '';
    if (!ip.includes('127.0.0.1') && !ip.includes('::1')) {
      throw new ForbiddenException('Solo accesible desde localhost');
    }
    const permitir = await this.svc.verificarSesionCn(body.cn ?? '', body.ipNueva);
    return { permitir };
  }

  // ── Notificar desconexión VPN (client-disconnect) ─────────────
  // Llamado por vpn-client-disconnect.sh cuando OpenVPN cierra un túnel.
  // Actualiza el estado del cliente en BD sin esperar al siguiente poll.
  @Post('disconnect-notify')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Notificar desconexión de túnel VPN (uso interno — solo localhost)' })
  async disconnectNotify(
    @Body() body: { cn: string },
    @Req()  req:  Request,
  ) {
    const ip = req.socket.remoteAddress ?? '';
    if (!ip.includes('127.0.0.1') && !ip.includes('::1')) {
      throw new ForbiddenException('Solo accesible desde localhost');
    }
    if (!body?.cn) return StdResponse.ok(null, 'Sin CN');
    await this.svc.notificarDesconexion(body.cn);
    return StdResponse.ok(null, 'Desconexión registrada');
  }

  // ── Listar alertas VPN activas ────────────────────────────────

  @Get('alertas')
  @RequirePermission('mikrotik:manage')
  @ApiOperation({ summary: 'Listar alertas VPN no leídas (intentos de conexión bloqueados o sesiones eliminadas)' })
  async listarAlertas(@CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.svc.listarAlertas(user.empresaId), 'Alertas VPN');
  }

  // ── Descartar alerta ──────────────────────────────────────────

  @Post(':id/descartar-alerta')
  @RequirePermission('mikrotik:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marcar alerta VPN como leída (descartarla)' })
  async descartarAlerta(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.svc.descartarAlerta(id, user.empresaId);
    return StdResponse.ok(null, 'Alerta descartada');
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
