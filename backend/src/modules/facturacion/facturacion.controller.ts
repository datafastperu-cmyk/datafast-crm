import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, Req, Res,
  ParseUUIDPipe, HttpCode, HttpStatus,
  SetMetadata, Logger,
} from '@nestjs/common';
import {
  ApiTags, ApiBearerAuth, ApiOperation,
  ApiResponse, ApiParam, ApiQuery,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';

import { FacturacionService } from './facturacion.service';
import {
  CreateFacturaDto, GenerarFacturasMensualesDto,
  CreateNotaCreditoDto, AnularFacturaDto, FilterFacturaDto,
} from './dto/factura.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission, Roles } from '../../common/decorators/roles.decorator';
import { ApiResponse as StdResponse } from '../../common/dto/response.dto';

@ApiTags('Facturación')
@ApiBearerAuth('JWT')
@Controller('facturacion')
export class FacturacionController {
  private readonly logger = new Logger(FacturacionController.name);

  constructor(private readonly svc: FacturacionService) {}

  // ── POST /facturacion — Crear factura manual ──────────────
  @Post()
  @RequirePermission('facturas:create')
  @ApiOperation({
    summary: 'Crear factura manual',
    description:
      'Crea un comprobante de forma manual. Calcula IGV automáticamente. ' +
      'El PDF se genera de forma asíncrona.',
  })
  @ApiResponse({ status: 201, description: 'Factura creada' })
  async create(
    @Body() dto: CreateFacturaDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const f = await this.svc.create(dto, user, req);
    return StdResponse.ok(f, 'Factura emitida correctamente');
  }

  // ── POST /facturacion/generar-mensual — Generación masiva ─
  @Post('generar-mensual')
  @HttpCode(HttpStatus.OK)
  @Roles('Administrador', 'Supervisor')
  // Rate limit estricto: solo una ejecución masiva por minuto
  @Throttle({ default: { limit: 1, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Generar facturas mensuales masivas',
    description:
      'Crea facturas para todos los contratos activos del mes/año indicado. ' +
      'Es idempotente: omite contratos ya facturados en el periodo. ' +
      'Puede tomar varios segundos en empresas con muchos contratos.',
  })
  @ApiResponse({ status: 200, description: 'Resultado de la generación masiva' })
  async generarMensual(
    @Body() dto: GenerarFacturasMensualesDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const resultado = await this.svc.generarMensual(dto, user, req);
    return StdResponse.ok(resultado,
      `Generación completada: ${resultado.exitosas} facturas creadas, ${resultado.omitidas} omitidas`,
    );
  }

  // ── GET /facturacion — Listar facturas ────────────────────
  @Get()
  @RequirePermission('facturas:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Listar facturas con filtros y paginación' })
  async findAll(
    @Query() filters: FilterFacturaDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const r = await this.svc.findAll(user.empresaId, filters);
    return StdResponse.ok(r.data, 'Facturas obtenidas', { meta: r.meta });
  }

  // ── GET /facturacion/resumen — Dashboard financiero ───────
  @Get('resumen')
  @RequirePermission('reports:financial')
  @SetMetadata('skipAudit', true)
  @ApiOperation({
    summary: 'Resumen financiero del mes actual',
    description:
      'Retorna: facturado, cobrado, cuentas por cobrar, facturas vencidas, tasa de cobranza.',
  })
  async getResumen(@CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.svc.getResumenFinanciero(user.empresaId));
  }

  // ── GET /facturacion/contrato/:id — Por contrato ──────────
  @Get('contrato/:contratoId')
  @RequirePermission('facturas:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Facturas de un contrato específico' })
  @ApiParam({ name: 'contratoId' })
  async findByContrato(
    @Param('contratoId', ParseUUIDPipe) contratoId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.findByContrato(contratoId, user.empresaId));
  }

  // ── GET /facturacion/cliente/:id — Por cliente ────────────
  @Get('cliente/:clienteId')
  @RequirePermission('facturas:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Facturas de un cliente específico (últimas 50)' })
  @ApiParam({ name: 'clienteId' })
  async findByCliente(
    @Param('clienteId', ParseUUIDPipe) clienteId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.findByCliente(clienteId, user.empresaId));
  }

  // ── GET /facturacion/:id — Obtener una ───────────────────
  @Get(':id')
  @RequirePermission('facturas:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Obtener factura por ID' })
  @ApiParam({ name: 'id' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.findOne(id, user.empresaId));
  }

  // ── GET /facturacion/:id/pdf — Descargar PDF ─────────────
  @Get(':id/pdf')
  @RequirePermission('facturas:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({
    summary: 'Descargar PDF de la factura',
    description: 'Si el PDF no existe se regenera. Redirige al archivo.',
  })
  @ApiParam({ name: 'id' })
  async descargarPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const factura = await this.svc.findOne(id, user.empresaId);

    if (!factura.pdfUrl) {
      // Regenerar si no existe
      const regenerada = await this.svc.regenerarPdf(id, user.empresaId);
      if (!regenerada.pdfUrl) {
        return res.status(202).json({ message: 'PDF en generación — intenta en unos segundos' });
      }
      return res.redirect(regenerada.pdfUrl);
    }

    return res.redirect(factura.pdfUrl);
  }

  // ── POST /facturacion/:id/pdf — Regenerar PDF ────────────
  @Post(':id/pdf')
  @RequirePermission('facturas:view')
  @ApiOperation({ summary: 'Forzar regeneración del PDF de la factura' })
  @ApiParam({ name: 'id' })
  async regenerarPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const f = await this.svc.regenerarPdf(id, user.empresaId);
    return StdResponse.ok({ pdfUrl: f.pdfUrl }, 'PDF regenerado');
  }

  // ── POST /facturacion/:id/nota-credito — Nota de crédito ─
  @Post(':id/nota-credito')
  @RequirePermission('facturas:create')
  @ApiOperation({
    summary: 'Emitir nota de crédito',
    description:
      'Crea una nota de crédito referenciando la factura original. ' +
      'Útil para rectificar montos sin anular el comprobante.',
  })
  @ApiParam({ name: 'id', description: 'UUID de la factura original' })
  async crearNotaCredito(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Omit<CreateNotaCreditoDto, 'facturaOriginalId'>,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const nc = await this.svc.crearNotaCredito(
      { ...dto, facturaOriginalId: id },
      user, req,
    );
    return StdResponse.ok(nc, 'Nota de crédito emitida');
  }

  // ── PATCH /facturacion/:id/anular — Anular ───────────────
  @Patch(':id/anular')
  @RequirePermission('facturas:delete')
  @ApiOperation({
    summary: 'Anular factura',
    description:
      'Solo facturas en estado emitida/vencida/en_cobranza. ' +
      'No se puede anular una factura pagada (usar nota de crédito). ' +
      'Por defecto genera una nota de crédito automáticamente.',
  })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 400, description: 'Factura ya anulada o pagada' })
  async anular(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AnularFacturaDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const result = await this.svc.anular(id, dto, user, req);
    const msg = result.notaCredito
      ? `Factura anulada. Nota de crédito: ${result.notaCredito.numeroCompleto}`
      : 'Factura anulada';
    return StdResponse.ok(result, msg);
  }

  // ── PATCH /facturacion/vencer — Marcar vencidas (cron) ───
  @Patch('admin/marcar-vencidas')
  @Roles('Administrador')
  @ApiOperation({
    summary: 'Marcar facturas vencidas (admin)',
    description: 'Normalmente ejecutado por el cron. Disponible para ejecución manual.',
  })
  async marcarVencidas(@CurrentUser() user: JwtPayload) {
    const count = await this.svc.marcarVencidas();
    return StdResponse.ok({ marcadas: count }, `${count} facturas marcadas como vencidas`);
  }
}
