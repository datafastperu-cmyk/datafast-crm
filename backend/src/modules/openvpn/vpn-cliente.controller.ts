import {
  Controller, Get, Post, Delete,
  Body, Param, Res, HttpCode, HttpStatus,
  ForbiddenException, Req, Logger,
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
  private readonly logger = new Logger(VpnClienteController.name);

  /**
   * Última vez que se registró un rechazo de auth por usuario.
   *
   * Un MikroTik cuyo cert fue revocado reintenta cada ~15 s PARA SIEMPRE: nadie le avisó
   * que dejara de intentar. Sin throttle son ~5 700 líneas por día por router zombi, y el
   * ruido tapa justamente los fallos que sí importan. Se registra el primer rechazo y
   * luego uno cada VENTANA — suficiente para que un operador lo note, no tanto como para
   * enterrar el log.
   */
  private readonly ultimoRechazo = new Map<string, number>();
  private static readonly VENTANA_LOG_RECHAZO_MS = 10 * 60 * 1000;

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

  // ── Reconciliar estado de TODOS los clientes ──────────────────
  // El cron lo hace cada 5 min; este endpoint permite forzarlo cuando el operador ve un
  // estado que no cuadra y no quiere esperar. Va ANTES de las rutas con `:id` para que
  // "reconciliar" no se interprete como un identificador.

  @Post('reconciliar-estado')
  @RequirePermission('mikrotik:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sincronizar el estado de los clientes VPN con las sesiones reales del servidor' })
  async reconciliar() {
    const r = await this.svc.reconciliarEstadoConexion();
    return StdResponse.ok(
      r,
      `Revisados ${r.revisados} | conectados ${r.conectados} | desconectados ${r.desconectados}` +
      (r.incidencias ? ` | INCIDENCIAS ${r.incidencias}` : ''),
    );
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

  /**
   * Un rechazo de credenciales NO se expresa como excepción, a propósito.
   *
   * Incidente 2026-07-31: el log de errores del backend estaba saturado por este endpoint
   * —cientos de entradas de nivel `error` con stack trace completo— y ninguna decía QUÉ
   * usuario fallaba. Era imposible diagnosticarlo, y llevaba días así.
   *
   * Dos defectos distintos, ambos corregidos aquí:
   *
   *  1. Una contraseña incorrecta es el resultado ESPERADO de un verificador de
   *     credenciales, no una condición excepcional. Lanzar `UnauthorizedException`
   *     hacía que el filtro global la registrara como error con stack trace, y el ruido
   *     tapaba los fallos reales. El único consumidor es `vpn-auth.sh`, un orquestador
   *     automático: por la directriz de "vocabulario de dominio, no de transporte", el
   *     veredicto viaja como DATO (`success: false`), no como excepción HTTP.
   *
   *     El comportamiento del script no cambia: hace `curl -sf` y luego
   *     `grep -q '"success":true'`. Con 200 + `success:false`, curl tiene éxito, el grep
   *     falla y el script devuelve exit 1 — deniega igual que antes.
   *
   *  2. El log no nombraba al usuario. Un log describe lo que ocurrió; "Credenciales
   *     inválidas" sin identidad no describe nada accionable.
   */
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

    const username = body.username ?? '';
    const ok = await this.svc.verifyAuth(username, body.password ?? '');

    if (!ok) {
      this._registrarRechazo(username, ip);
      return StdResponse.error('Credenciales inválidas');
    }

    this.ultimoRechazo.delete(username); // volvió a autenticar: la racha terminó
    return StdResponse.ok(null, 'Autenticado');
  }

  /**
   * Registra el rechazo nombrando al usuario, con throttle por ventana.
   *
   * Nivel `warn` y no `error`: un cliente con credenciales viejas reintentando es una
   * condición operativa conocida —típicamente un MikroTik al que se le revocó el cert
   * pero conserva la interfaz `vpndatafast` configurada— no una falla del backend.
   */
  private _registrarRechazo(username: string, ip: string): void {
    const ahora = Date.now();
    const previo = this.ultimoRechazo.get(username) ?? 0;
    if (ahora - previo < VpnClienteController.VENTANA_LOG_RECHAZO_MS) return;

    this.ultimoRechazo.set(username, ahora);
    this.logger.warn(
      `VPN auth rechazada para "${username || '(sin usuario)'}" desde ${ip}. ` +
      `Si reintenta en bucle, el equipo conserva una interfaz ovpn-client con ` +
      `credenciales revocadas: hay que eliminarla en el router.`,
    );
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
