import {
  Controller, Get, Post, Patch, Delete, Put,
  Body, Param, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { ComprobantesConfigService } from './comprobantes-config.service';
import {
  CreateComprobanteConfigDto,
  UpdateComprobanteConfigDto,
  UpdateConfiguracionFacturacionDto,
} from './dto/comprobante-config.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Configuración de Facturación')
@ApiBearerAuth('JWT')
@Controller('facturacion-config')
export class ComprobantesConfigController {
  constructor(private readonly svc: ComprobantesConfigService) {}

  // ── Configuración global (moneda, igv, mora, reconexión) ─────

  @Get()
  @ApiOperation({ summary: 'Obtener configuración global de facturación + tipos de comprobante' })
  getResumen(@CurrentUser() user: JwtPayload) {
    return this.svc.getResumen(user.empresaId);
  }

  @Patch('global')
  @Roles('Administrador')
  @ApiOperation({ summary: 'Actualizar moneda, IGV/IVA, comportamiento de mora y reconexión' })
  updateConfiguracion(
    @Body() dto: UpdateConfiguracionFacturacionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.svc.updateConfiguracion(dto, user);
  }

  // ── Tipos de comprobante ──────────────────────────────────────

  @Get('comprobantes')
  @ApiOperation({ summary: 'Listar tipos de comprobante de la empresa' })
  listar(@CurrentUser() user: JwtPayload) {
    return this.svc.listar(user.empresaId);
  }

  @Post('comprobantes')
  @Roles('Administrador')
  @ApiOperation({ summary: 'Crear nuevo tipo de comprobante' })
  crear(
    @Body() dto: CreateComprobanteConfigDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.svc.crear(dto, user);
  }

  @Patch('comprobantes/:id')
  @Roles('Administrador')
  @ApiOperation({ summary: 'Actualizar tipo de comprobante (nombre, serie, carga fiscal, estado)' })
  actualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateComprobanteConfigDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.svc.actualizar(id, dto, user);
  }

  @Put('comprobantes/:id/default')
  @Roles('Administrador')
  @ApiOperation({ summary: 'Establecer como tipo de comprobante por defecto de la empresa' })
  setDefault(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.svc.setDefault(id, user);
  }

  @Delete('comprobantes/:id')
  @Roles('Administrador')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar tipo de comprobante (falla si hay clientes o facturas que lo usan)' })
  eliminar(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.svc.eliminar(id, user);
  }

  // ── Bancos ─────────────────────────────────────────────────────

  @Get('bancos')
  @ApiOperation({ summary: 'Listar bancos configurados' })
  listarBancos(@CurrentUser() user: JwtPayload) {
    return this.svc.listarBancos(user.empresaId);
  }

  @Post('bancos')
  @Roles('Administrador')
  @ApiOperation({ summary: 'Agregar banco' })
  crearBanco(@Body('nombre') nombre: string, @CurrentUser() user: JwtPayload) {
    return this.svc.crearBanco(nombre, user);
  }

  @Patch('bancos/:id')
  @Roles('Administrador')
  @ApiOperation({ summary: 'Editar banco' })
  actualizarBanco(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('nombre') nombre: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.svc.actualizarBanco(id, nombre, user);
  }

  @Delete('bancos/:id')
  @Roles('Administrador')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar banco (falla si es del sistema)' })
  eliminarBanco(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.svc.eliminarBanco(id, user);
  }

  // ── Formas de pago ──────────────────────────────────────────────

  @Get('formas-pago')
  @ApiOperation({ summary: 'Listar formas de pago configuradas' })
  listarFormasPago(@CurrentUser() user: JwtPayload) {
    return this.svc.listarFormasPago(user.empresaId);
  }

  @Post('formas-pago')
  @Roles('Administrador')
  @ApiOperation({ summary: 'Agregar forma de pago' })
  crearFormaPago(@Body('nombre') nombre: string, @CurrentUser() user: JwtPayload) {
    return this.svc.crearFormaPago(nombre, user);
  }

  @Patch('formas-pago/:id')
  @Roles('Administrador')
  @ApiOperation({ summary: 'Editar forma de pago' })
  actualizarFormaPago(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('nombre') nombre: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.svc.actualizarFormaPago(id, nombre, user);
  }

  @Delete('formas-pago/:id')
  @Roles('Administrador')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar forma de pago (falla si es del sistema)' })
  eliminarFormaPago(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.svc.eliminarFormaPago(id, user);
  }
}
