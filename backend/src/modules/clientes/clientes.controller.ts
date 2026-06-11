import {
  Controller, Get, Post, Put, Patch, Delete,
  Body, Param, Query, Req, Res, ParseUUIDPipe,
  HttpCode, HttpStatus, UseInterceptors,
  UploadedFile, Logger, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags, ApiOperation, ApiResponse, ApiBearerAuth,
  ApiParam, ApiQuery, ApiConsumes, ApiBody,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { SetMetadata } from '@nestjs/common';

import { ClientesService } from './clientes.service';
import {
  CreateClienteDto, UpdateClienteDto, FilterClienteDto,
  CambiarEstadoDto, ConsultarReniecDto, ExportClientesDto, BulkActionClienteDto,
  OnboardingDto, FacturacionConfigBodyDto,
} from './dto/cliente.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/roles.decorator';
import { ApiResponse as StdResponse } from '../../common/dto/response.dto';

@ApiTags('Clientes')
@ApiBearerAuth('JWT')
@Controller('clientes')
export class ClientesController {
  private readonly logger = new Logger(ClientesController.name);

  constructor(private readonly clientesSvc: ClientesService) {}

  // ── POST /clientes/onboarding — Wizard unificado ─────────
  @Post('onboarding')
  @RequirePermission('clientes:create')
  @ApiOperation({
    summary: 'Onboarding unificado: cliente + contrato + facturación',
    description: 'Crea el cliente, su primer contrato y la configuración de facturación en una sola llamada. El cliente pasa a ACTIVO si se incluye un plan.',
  })
  @ApiResponse({ status: 201, description: '{ cliente, contrato }' })
  async onboarding(
    @Body() dto: OnboardingDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const result = await this.clientesSvc.onboarding(dto, user, req);
    return StdResponse.ok(result, 'Abonado registrado correctamente');
  }

  // ── POST /clientes — Crear cliente ────────────────────────
  @Post()
  @RequirePermission('clientes:create')
  @ApiOperation({
    summary: 'Crear nuevo cliente',
    description: 'Registra un cliente. Si el documento ya existe en la empresa devuelve 409.',
  })
  @ApiResponse({ status: 201, description: 'Cliente creado correctamente' })
  @ApiResponse({ status: 409, description: 'Documento duplicado en la empresa' })
  async create(
    @Body() dto: CreateClienteDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const cliente = await this.clientesSvc.create(dto, user, req);
    return StdResponse.ok(cliente, 'Cliente registrado correctamente');
  }

  // ── GET /clientes — Listar con filtros ────────────────────
  @Get()
  @RequirePermission('clientes:view')
  @ApiOperation({
    summary: 'Listar clientes con filtros y paginación',
    description:
      'Soporta búsqueda de texto libre sobre nombre, documento, email, teléfono y dirección. ' +
      'Acepta filtros por estado, tipo de servicio, distrito, fechas, etiquetas y más.',
  })
  @ApiResponse({ status: 200, description: 'Lista paginada de clientes' })
  async findAll(
    @Query() filters: FilterClienteDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.clientesSvc.findAll(user.empresaId, filters);
    return StdResponse.ok(result.data, 'Clientes obtenidos', { meta: result.meta });
  }

  // ── POST /clientes/bulk-action — Acciones masivas ────────
  @Post('bulk-action')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('clientes:edit')
  @ApiOperation({
    summary: 'Acciones masivas sobre clientes',
    description: 'Aplica suspender, reactivar, baja_temporal o marcar_moroso a múltiples clientes.',
  })
  @ApiResponse({ status: 200, description: '{ ok, errors, total }' })
  async bulkAction(
    @Body() dto: BulkActionClienteDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const result = await this.clientesSvc.bulkAction(dto, user, req);
    return StdResponse.ok(result, `Acción masiva: ${result.ok} ok, ${result.errors} errores`);
  }

  // ── GET /clientes/resumen — Dashboard stats ───────────────
  @Get('resumen')
  @RequirePermission('clientes:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Resumen de clientes por estado (dashboard)' })
  async getResumen(@CurrentUser() user: JwtPayload) {
    const data = await this.clientesSvc.getResumen(user.empresaId);
    return StdResponse.ok(data);
  }

  // ── GET /clientes/mapa — Coordenadas para Google Maps ─────
  @Get('mapa')
  @RequirePermission('clientes:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Clientes con coordenadas GPS para el mapa' })
  async getMapa(@CurrentUser() user: JwtPayload) {
    const data = await this.clientesSvc.getMapa(user.empresaId);
    return StdResponse.ok(data);
  }

  // ── GET /clientes/exportar — Descargar CSV/XLSX ───────────
  @Get('exportar')
  @RequirePermission('clientes:export')
  @ApiOperation({
    summary: 'Exportar clientes a CSV o XLSX',
    description: 'Aplica los mismos filtros que el listado. Máximo 10.000 registros.',
  })
  @ApiQuery({ name: 'formato', enum: ['csv', 'xlsx'], required: false })
  async exportar(
    @Query() filters: ExportClientesDto,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    this.logger.log(`Exportando clientes | empresa: ${user.empresaId} | formato: ${filters.formato}`);
    await this.clientesSvc.exportar(user.empresaId, filters, res);
  }

  // ── POST /clientes/reniec — Consultar DNI ─────────────────
  @Post('reniec')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('clientes:create')
  @SetMetadata('skipAudit', true)
  @ApiOperation({
    summary: 'Consultar datos de RENIEC por DNI',
    description:
      'Retorna nombres y apellidos del titular. Los datos se cachean 24h. ' +
      'Si el servicio no está disponible retorna 503.',
  })
  @ApiResponse({ status: 200, description: 'Datos del titular del DNI' })
  @ApiResponse({ status: 400, description: 'DNI inválido (debe tener 8 dígitos)' })
  @ApiResponse({ status: 503, description: 'Servicio RENIEC no disponible' })
  async consultarReniec(@Body() dto: ConsultarReniecDto) {
    const data = await this.clientesSvc.consultarReniec(dto.dni);
    return StdResponse.ok(data, 'Datos RENIEC obtenidos correctamente');
  }

  // ── GET /clientes/:id — Obtener uno ──────────────────────
  @Get(':id')
  @RequirePermission('clientes:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Obtener datos completos de un cliente' })
  @ApiParam({ name: 'id', description: 'UUID del cliente' })
  @ApiResponse({ status: 200, description: 'Datos del cliente' })
  @ApiResponse({ status: 404, description: 'Cliente no encontrado' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.clientesSvc.findOne(id, user.empresaId);
    return StdResponse.ok(data);
  }

  // ── PATCH /clientes/:id — Actualizar campos del cliente ──────
  @Patch(':id')
  @RequirePermission('clientes:edit')
  @ApiOperation({ summary: 'Actualizar campos de un cliente (parcial o completo)' })
  @ApiParam({ name: 'id', description: 'UUID del cliente' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClienteDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const data = await this.clientesSvc.update(id, dto, user, req);
    return StdResponse.ok(data, 'Cliente actualizado correctamente');
  }

  // ── PATCH /clientes/:id/estado — Cambiar estado ───────────
  @Patch(':id/estado')
  @RequirePermission('clientes:edit')
  @ApiOperation({
    summary: 'Cambiar estado del cliente',
    description:
      'Respeta la máquina de estados: no se puede ir de BAJA_DEFINITIVA a ACTIVO, etc. ' +
      'El cambio queda registrado en el historial de estados.',
  })
  @ApiParam({ name: 'id', description: 'UUID del cliente' })
  @ApiResponse({ status: 200, description: 'Estado cambiado correctamente' })
  @ApiResponse({ status: 400, description: 'Transición de estado no permitida' })
  async cambiarEstado(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CambiarEstadoDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const data = await this.clientesSvc.cambiarEstado(id, dto, user, false, req);
    return StdResponse.ok(data, `Estado cambiado a ${dto.estado}`);
  }

  // ── GET /clientes/:id/facturacion-config ─────────────────
  @Get(':id/facturacion-config')
  @RequirePermission('clientes:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Obtener configuración de facturación del cliente' })
  async getFacturacionConfig(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.clientesSvc.getFacturacionConfig(id, user.empresaId);
    return StdResponse.ok(data);
  }

  // ── PUT /clientes/:id/facturacion-config ──────────────────
  @Put(':id/facturacion-config')
  @RequirePermission('clientes:edit')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Guardar configuración de facturación del cliente' })
  async saveFacturacionConfig(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: FacturacionConfigBodyDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.clientesSvc.saveFacturacionConfig(
      id, user.empresaId, body.facturacion ?? {}, body.notificaciones ?? {},
    );
    return StdResponse.ok(data, 'Configuración guardada');
  }

  // ── GET /clientes/:id/contratos — Servicios del cliente ──
  @Get(':id/contratos')
  @RequirePermission('clientes:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Contratos/servicios del cliente' })
  @ApiParam({ name: 'id', description: 'UUID del cliente' })
  async getContratos(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.clientesSvc.getContratos(id, user.empresaId);
    return StdResponse.ok(data);
  }

  // ── GET /clientes/:id/historial — Historial de estados ───
  @Get(':id/historial')
  @RequirePermission('clientes:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Historial de cambios de estado del cliente' })
  @ApiParam({ name: 'id', description: 'UUID del cliente' })
  async getHistorial(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    const data = await this.clientesSvc.getHistorial(
      id, user.empresaId,
      limit ? Number(limit) : 50,
      offset ? Number(offset) : 0,
    );
    return StdResponse.ok(data);
  }

  // ── POST /clientes/:id/foto — Subir foto ─────────────────
  @Post(':id/foto')
  @RequirePermission('clientes:edit')
  @UseInterceptors(
    FileInterceptor('foto', {
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
      fileFilter: (_, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp'];
        if (!allowed.includes(file.mimetype)) {
          cb(new Error('Solo se permiten imágenes JPG, PNG o WebP'), false);
        } else {
          cb(null, true);
        }
      },
    }),
  )
  @ApiOperation({ summary: 'Subir foto del cliente' })
  @ApiConsumes('multipart/form-data')
  @ApiParam({ name: 'id', description: 'UUID del cliente' })
  async subirFoto(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('No se recibió ningún archivo');
    const fotoUrl = await this.clientesSvc.procesarFoto(id, file, user.empresaId);
    await this.clientesSvc.update(id, { fotoUrl }, user, req);
    return StdResponse.ok({ fotoUrl }, 'Foto actualizada correctamente');
  }

  // ── DELETE /clientes/:id — Eliminar (soft delete) ─────────
  @Delete(':id')
  @RequirePermission('clientes:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Eliminar cliente (soft delete)',
    description: 'Solo se puede eliminar un cliente que NO esté activo.',
  })
  @ApiParam({ name: 'id', description: 'UUID del cliente' })
  @ApiResponse({ status: 204, description: 'Cliente eliminado' })
  @ApiResponse({ status: 400, description: 'No se puede eliminar cliente activo' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ): Promise<void> {
    await this.clientesSvc.remove(id, user, req);
  }

}
