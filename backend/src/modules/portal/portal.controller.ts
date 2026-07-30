import {
  Controller, Get, Post, Body, Req, Res, Param, ParseUUIDPipe,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';

import { Public }      from '../../common/decorators/public.decorator';
import { ApiResponse } from '../../common/dto/response.dto';

import { PortalAuthService }   from './portal-auth.service';
import { PortalClienteService } from './portal-cliente.service';
import { PortalConfigService }  from './portal-config.service';
import { PortalTenantService }  from './portal-tenant.service';
import { PortalJwtGuard, ClientePortal, PortalJwtPayload } from './portal-auth.guard';

export class PortalLoginDto {
  @IsString() @MinLength(1) @MaxLength(50)
  usuario: string;

  @IsString() @MinLength(1) @MaxLength(100)
  password: string;
}

// Superficie que consume el ABONADO. Va marcada @Public() para saltar el guard JWT del
// ERP —que exige un token de operador— y protegida por PortalJwtGuard, que solo acepta
// tokens con audiencia `datafast-portal`. Las dos audiencias no se cruzan.
@ApiTags('Portal del Cliente')
@Controller('portal')
@Public()
export class PortalController {
  constructor(
    private readonly auth:    PortalAuthService,
    private readonly cliente: PortalClienteService,
    private readonly config:  PortalConfigService,
    private readonly tenant:  PortalTenantService,
  ) {}

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
  logout(@Res({ passthrough: true }) res: Response): void {
    this.auth.logout(res);
  }

  // ── Datos del abonado ───────────────────────────────────────
  @Get('me')
  @UseGuards(PortalJwtGuard)
  @ApiOperation({ summary: 'Perfil del titular y sus servicios' })
  async me(@ClientePortal() sesion: PortalJwtPayload) {
    return ApiResponse.ok(await this.cliente.perfil(sesion.sub, sesion.empresaId));
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
