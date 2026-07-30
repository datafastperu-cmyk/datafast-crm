import {
  Controller, Get, Post, Put, Body, Req, Res, Param, Query, ParseUUIDPipe, NotFoundException,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import {
  IsString, MinLength, MaxLength, IsOptional, IsUUID, IsInt, Min, Max,
} from 'class-validator';

import { Public }      from '../../common/decorators/public.decorator';
import { ApiResponse } from '../../common/dto/response.dto';

import { PortalAuthService }   from './portal-auth.service';
import { PortalClienteService } from './portal-cliente.service';
import { PortalFacturacionService } from './portal-facturacion.service';
import { PortalOnuService } from './portal-onu.service';
import { PortalConsumoService } from './portal-consumo.service';
import { PortalSoporteService } from './portal-soporte.service';
import { PortalPlanesService } from './portal-planes.service';
import { PortalConfigService }  from './portal-config.service';
import { PortalTenantService }  from './portal-tenant.service';
import { PortalJwtGuard, ClientePortal, PortalJwtPayload } from './portal-auth.guard';

export class PortalLoginDto {
  @IsString() @MinLength(1) @MaxLength(50)
  usuario: string;

  @IsString() @MinLength(1) @MaxLength(100)
  password: string;
}

export class PortalWifiDto {
  @IsOptional() @IsString() @MaxLength(32)
  ssid?: string;

  // El mínimo de 8 es de WPA2: por debajo, el propio equipo rechaza la clave. El resto
  // de reglas (triviales, igual al SSID) vive en el servicio, junto al mensaje que las
  // explica.
  @IsOptional() @IsString() @MinLength(8) @MaxLength(63)
  password?: string;
}

export class PortalTicketDto {
  @IsUUID()
  contratoId: string;

  @IsString()
  categoria: string;

  // Un "no tengo internet" sin una línea de contexto obliga a llamar al abonado para
  // saber qué pasa; el mínimo evita ese viaje.
  @IsString() @MinLength(10) @MaxLength(1000)
  descripcion: string;
}

export class PortalSolicitudPlanDto {
  @IsUUID()
  planDestinoId: string;

  @IsOptional() @IsString() @MaxLength(500)
  nota?: string;
}

export class PortalCalificarDto {
  @IsInt() @Min(1) @Max(5)
  calificacion: number;

  @IsOptional() @IsString() @MaxLength(500)
  comentario?: string;
}

// Superficie que consume el ABONADO. Va marcada @Public() para saltar el guard JWT del
// ERP —que exige un token de operador— y protegida por PortalJwtGuard, que solo acepta
// tokens con audiencia `datafast-portal`. Las dos audiencias no se cruzan.
@ApiTags('Portal del Cliente')
@Controller('portal')
@Public()
export class PortalController {
  constructor(
    private readonly auth:        PortalAuthService,
    private readonly cliente:     PortalClienteService,
    private readonly config:      PortalConfigService,
    private readonly tenant:      PortalTenantService,
    private readonly facturacion: PortalFacturacionService,
    private readonly onu:         PortalOnuService,
    private readonly consumoSvc:  PortalConsumoService,
    private readonly soporte:     PortalSoporteService,
    private readonly planesSvc:   PortalPlanesService,
  ) {}

  // Los toggles del panel son feature flags REALES: con la sección apagada el endpoint
  // deja de existir para el abonado. Ocultar el botón dejando la API viva no es un
  // control de acceso, es maquillaje.
  private async exigirSeccion(
    empresaId: string,
    flag: 'mostrarComprobantes' | 'mostrarWifi' | 'mostrarDispositivos'
        | 'mostrarSoporte' | 'mostrarPlanes' | 'mostrarConsumo',
  ): Promise<void> {
    const { config } = await this.config.obtener(empresaId);
    if (!config[flag]) throw new NotFoundException('Sección no disponible');
  }

  // ── Configuración pública del portal (branding y secciones) ──
  @Get('config')
  @ApiOperation({ summary: 'Configuración pública del portal (resuelta por dominio)' })
  async configPublica(@Req() req: Request) {
    const empresaId = await this.tenant.resolverEmpresaId(req.headers.host);
    const { config } = await this.config.obtener(empresaId);

    // Solo lo que ya es visible en pantalla. Nada de destinatarios internos de avisos.
    return ApiResponse.ok({
      titulo:                     config.titulo,
      logoUrl:                    config.logoUrl,
      colorPrimario:              config.colorPrimario,
      tema:                       config.tema,
      urlTestVelocidad:           config.mostrarTestVelocidad ? config.urlTestVelocidad : null,
      tituloMenuPersonalizado:    config.mostrarMenuPersonalizado ? config.tituloMenuPersonalizado : null,
      contenidoMenuPersonalizado: config.mostrarMenuPersonalizado ? config.contenidoMenuPersonalizado : null,
      reportePagoMedios:          config.mostrarInformarPago ? config.reportePagoMedios : null,
      secciones: {
        comprobantes:  config.mostrarComprobantes,
        soporte:       config.mostrarSoporte,
        informarPago:  config.mostrarInformarPago,
        testVelocidad: config.mostrarTestVelocidad,
        notificaciones: config.mostrarNotificaciones,
        wifi:          config.mostrarWifi,
        dispositivos:  config.mostrarDispositivos,
        planes:        config.mostrarPlanes,
        consumo:       config.mostrarConsumo,
        banner:        config.mostrarBanner,
        menuPersonalizado: config.mostrarMenuPersonalizado,
      },
    });
  }

  // ── Autenticación ───────────────────────────────────────────
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Iniciar sesión en el portal del cliente' })
  async login(
    @Body() dto: PortalLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const sesion = await this.auth.login(dto.usuario, dto.password, req, res);
    return ApiResponse.ok(sesion, 'Sesión iniciada');
  }

  @Post('auth/refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Renovar la sesión del portal' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return ApiResponse.ok(await this.auth.refresh(req, res));
  }

  @Post('auth/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cerrar sesión del portal' })
  logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): void {
    // Se pasa el request porque borrar la cookie exige los MISMOS atributos con que se
    // escribió (incluido `Secure`, que depende del protocolo de la petición).
    this.auth.logout(req, res);
  }

  // ── Datos del abonado ───────────────────────────────────────
  @Get('me')
  @UseGuards(PortalJwtGuard)
  @ApiOperation({ summary: 'Perfil del titular y sus servicios' })
  async me(@ClientePortal() sesion: PortalJwtPayload) {
    return ApiResponse.ok(await this.cliente.perfil(sesion.sub, sesion.empresaId));
  }

  // ── Facturación ─────────────────────────────────────────────
  @Get('facturas/:contratoId')
  @UseGuards(PortalJwtGuard)
  @ApiOperation({ summary: 'Estado de cuenta y facturas del servicio' })
  @ApiParam({ name: 'contratoId' })
  async facturas(
    @ClientePortal() sesion: PortalJwtPayload,
    @Param('contratoId', ParseUUIDPipe) contratoId: string,
  ) {
    await this.exigirSeccion(sesion.empresaId, 'mostrarComprobantes');
    return ApiResponse.ok(
      await this.facturacion.estadoCuenta(sesion.sub, sesion.empresaId, contratoId),
    );
  }

  // ── Mi WiFi y dispositivos ──────────────────────────────────
  @Get('onu/:contratoId/estado')
  @UseGuards(PortalJwtGuard)
  @ApiOperation({ summary: 'Estado de la conexión con el router del abonado' })
  @ApiParam({ name: 'contratoId' })
  async onuEstado(
    @ClientePortal() sesion: PortalJwtPayload,
    @Param('contratoId', ParseUUIDPipe) contratoId: string,
  ) {
    await this.exigirSeccion(sesion.empresaId, 'mostrarWifi');
    return ApiResponse.ok(await this.onu.estado(sesion.sub, sesion.empresaId, contratoId));
  }

  // Responde de inmediato: la activación del carril la ejecuta el outbox (hasta ~5 min).
  // El portal consulta `estado` hasta ver "conectado" — no hay request colgada esperando
  // a la OLT.
  @Post('onu/:contratoId/conectar')
  @UseGuards(PortalJwtGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Conectar el router (abre el carril de gestión)' })
  @ApiParam({ name: 'contratoId' })
  async onuConectar(
    @ClientePortal() sesion: PortalJwtPayload,
    @Param('contratoId', ParseUUIDPipe) contratoId: string,
  ) {
    await this.exigirSeccion(sesion.empresaId, 'mostrarWifi');
    return ApiResponse.ok(await this.onu.conectar(sesion.sub, sesion.empresaId, contratoId));
  }

  @Post('onu/:contratoId/heartbeat')
  @UseGuards(PortalJwtGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Marcar uso del carril (evita que se cierre por inactividad)' })
  @ApiParam({ name: 'contratoId' })
  async onuHeartbeat(
    @ClientePortal() sesion: PortalJwtPayload,
    @Param('contratoId', ParseUUIDPipe) contratoId: string,
  ): Promise<void> {
    await this.onu.heartbeat(sesion.sub, sesion.empresaId, contratoId);
  }

  @Get('onu/:contratoId/wifi')
  @UseGuards(PortalJwtGuard)
  @ApiOperation({ summary: 'Redes WiFi del abonado (lectura viva del equipo)' })
  @ApiParam({ name: 'contratoId' })
  async onuWifi(
    @ClientePortal() sesion: PortalJwtPayload,
    @Param('contratoId', ParseUUIDPipe) contratoId: string,
  ) {
    await this.exigirSeccion(sesion.empresaId, 'mostrarWifi');
    return ApiResponse.ok(await this.onu.wifi(sesion.sub, sesion.empresaId, contratoId));
  }

  @Put('onu/:contratoId/wifi/:banda')
  @UseGuards(PortalJwtGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Cambiar nombre y/o contraseña de una banda WiFi' })
  @ApiParam({ name: 'contratoId' })
  @ApiParam({ name: 'banda', enum: ['2.4', '5'] })
  async onuGuardarWifi(
    @ClientePortal() sesion: PortalJwtPayload,
    @Param('contratoId', ParseUUIDPipe) contratoId: string,
    @Param('banda') banda: string,
    @Body() dto: PortalWifiDto,
  ) {
    await this.exigirSeccion(sesion.empresaId, 'mostrarWifi');
    if (banda !== '2.4' && banda !== '5') {
      throw new NotFoundException('Banda no válida');
    }
    const resultado = await this.onu.guardarWifi(
      sesion.sub, sesion.empresaId, contratoId, banda, dto,
    );
    return ApiResponse.ok(resultado, resultado.mensaje);
  }

  @Get('onu/:contratoId/dispositivos')
  @UseGuards(PortalJwtGuard)
  @ApiOperation({ summary: 'Dispositivos conectados a la red del abonado' })
  @ApiParam({ name: 'contratoId' })
  async onuDispositivos(
    @ClientePortal() sesion: PortalJwtPayload,
    @Param('contratoId', ParseUUIDPipe) contratoId: string,
  ) {
    await this.exigirSeccion(sesion.empresaId, 'mostrarDispositivos');
    return ApiResponse.ok(await this.onu.dispositivos(sesion.sub, sesion.empresaId, contratoId));
  }

  // ── Consumo ─────────────────────────────────────────────────
  @Get('consumo/:contratoId')
  @UseGuards(PortalJwtGuard)
  @ApiOperation({ summary: 'Consumo de datos: acumulado del mes y por día' })
  @ApiParam({ name: 'contratoId' })
  async consumo(
    @ClientePortal() sesion: PortalJwtPayload,
    @Param('contratoId', ParseUUIDPipe) contratoId: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    await this.exigirSeccion(sesion.empresaId, 'mostrarConsumo');
    return ApiResponse.ok(
      await this.consumoSvc.consumo(sesion.sub, sesion.empresaId, contratoId, desde, hasta),
    );
  }

  // ── Soporte ─────────────────────────────────────────────────
  @Get('tickets')
  @UseGuards(PortalJwtGuard)
  @ApiOperation({ summary: 'Solicitudes de soporte del abonado' })
  async tickets(@ClientePortal() sesion: PortalJwtPayload) {
    await this.exigirSeccion(sesion.empresaId, 'mostrarSoporte');
    return ApiResponse.ok({
      categorias: this.soporte.categoriasDisponibles(),
      tickets:    await this.soporte.listar(sesion.sub, sesion.empresaId),
    });
  }

  @Post('tickets')
  @UseGuards(PortalJwtGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Abrir una solicitud de soporte' })
  async crearTicket(
    @ClientePortal() sesion: PortalJwtPayload,
    @Body() dto: PortalTicketDto,
  ) {
    await this.exigirSeccion(sesion.empresaId, 'mostrarSoporte');
    const ticket = await this.soporte.crear(sesion.sub, sesion.empresaId, dto);
    return ApiResponse.ok(ticket, `Registramos tu solicitud ${ticket.numero}.`);
  }

  @Post('tickets/:id/calificar')
  @UseGuards(PortalJwtGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Calificar la atención de una solicitud cerrada' })
  @ApiParam({ name: 'id' })
  async calificarTicket(
    @ClientePortal() sesion: PortalJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PortalCalificarDto,
  ): Promise<void> {
    await this.exigirSeccion(sesion.empresaId, 'mostrarSoporte');
    await this.soporte.calificar(
      sesion.sub, sesion.empresaId, id, dto.calificacion, dto.comentario,
    );
  }

  // ── Planes ──────────────────────────────────────────────────
  @Get('planes/:contratoId')
  @UseGuards(PortalJwtGuard)
  @ApiOperation({ summary: 'Planes disponibles y solicitud en curso' })
  @ApiParam({ name: 'contratoId' })
  async planes(
    @ClientePortal() sesion: PortalJwtPayload,
    @Param('contratoId', ParseUUIDPipe) contratoId: string,
  ) {
    await this.exigirSeccion(sesion.empresaId, 'mostrarPlanes');
    return ApiResponse.ok(await this.planesSvc.catalogo(sesion.sub, sesion.empresaId, contratoId));
  }

  // SOLICITA, no cambia. La aplicación real la hace el operador por el flujo de negocio.
  @Post('planes/:contratoId/solicitud')
  @UseGuards(PortalJwtGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Solicitar un cambio de plan' })
  @ApiParam({ name: 'contratoId' })
  async solicitarPlan(
    @ClientePortal() sesion: PortalJwtPayload,
    @Param('contratoId', ParseUUIDPipe) contratoId: string,
    @Body() dto: PortalSolicitudPlanDto,
  ) {
    await this.exigirSeccion(sesion.empresaId, 'mostrarPlanes');
    const solicitud = await this.planesSvc.solicitar(
      sesion.sub, sesion.empresaId, contratoId, dto.planDestinoId, dto.nota,
    );
    return ApiResponse.ok(
      solicitud,
      'Recibimos tu solicitud. Te contactaremos para confirmarla.',
    );
  }

  @Get('servicios/:contratoId')
  @UseGuards(PortalJwtGuard)
  @ApiOperation({ summary: 'Detalle de un servicio del abonado' })
  @ApiParam({ name: 'contratoId' })
  async servicio(
    @ClientePortal() sesion: PortalJwtPayload,
    @Param('contratoId', ParseUUIDPipe) contratoId: string,
  ) {
    return ApiResponse.ok(
      await this.cliente.servicio(sesion.sub, sesion.empresaId, contratoId),
    );
  }
}
