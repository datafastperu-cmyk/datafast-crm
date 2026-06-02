import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, Req, Res,
  ParseUUIDPipe, HttpCode, HttpStatus,
  SetMetadata, Logger, Headers,
  RawBodyRequest, UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags, ApiBearerAuth, ApiOperation,
  ApiResponse, ApiParam, ApiConsumes,
  ApiHeader,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { memoryStorage } from 'multer';

import { PagosService }   from './pagos.service';
import {
  RegistrarPagoDto, VerificarPagoDto, ConciliarPagoDto,
  FilterPagoDto, CrearPreferenciaDto, CreateCuentaBancariaDto,
} from './dto/pago.dto';
import { EstadoPago } from './entities/pago.entity';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission, Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ApiResponse as StdResponse } from '../../common/dto/response.dto';

@ApiTags('Pagos')
@ApiBearerAuth('JWT')
@Controller('pagos')
export class PagosController {
  private readonly logger = new Logger(PagosController.name);

  constructor(private readonly svc: PagosService) {}

  // ── POST /pagos — Registrar pago ──────────────────────────
  @Post()
  @RequirePermission('pagos:create')
  @ApiOperation({
    summary: 'Registrar pago',
    description:
      'Registra un pago de cliente. Verifica duplicados por número de operación. ' +
      'Si el método es Efectivo o se marca autoVerificar=true, se aplica inmediatamente ' +
      'y dispara la reactivación automática del servicio si el contrato tenía mora.',
  })
  @ApiResponse({ status: 201, description: 'Pago registrado' })
  @ApiResponse({ status: 409, description: 'Duplicado — número de operación ya registrado' })
  async registrar(
    @Body() dto: RegistrarPagoDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const pago = await this.svc.registrar(dto, user, req);
    const mensaje = pago.estado === EstadoPago.VERIFICADO
      ? 'Pago procesado y verificado con éxito.'
      : 'Pago registrado. Pendiente de verificación manual.';
    return StdResponse.ok(pago, mensaje);
  }

  // ── GET /pagos — Listar con filtros ───────────────────────
  @Get()
  @RequirePermission('pagos:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Listar pagos con filtros y paginación' })
  async findAll(
    @Query() filters: FilterPagoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const r = await this.svc.findAll(user.empresaId, filters);
    return StdResponse.ok(r.data, 'Pagos obtenidos', { meta: r.meta });
  }

  // ── GET /pagos/resumen — Dashboard de cobranza ────────────
  @Get('resumen')
  @RequirePermission('pagos:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({
    summary: 'Resumen de cobranza (dashboard)',
    description: 'Cobrado hoy/semana/mes, pagos por método, pendientes de verificar, últimos pagos.',
  })
  async getResumen(@CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.svc.getResumen(user.empresaId));
  }

  // ── GET /pagos/pendientes — Pagos por verificar ───────────
  @Get('pendientes')
  @RequirePermission('pagos:verify')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Pagos pendientes de verificación manual' })
  async findPendientes(@CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.svc.findPendientes(user.empresaId));
  }

  // ── GET /pagos/cuentas — Cuentas bancarias ────────────────
  @Get('cuentas')
  @RequirePermission('pagos:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Cuentas bancarias de la empresa' })
  async getCuentas(@CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.svc.getCuentasBancarias(user.empresaId));
  }

  // ── POST /pagos/cuentas — Agregar cuenta bancaria ─────────
  @Post('cuentas')
  @Roles('Administrador', 'Supervisor')
  @ApiOperation({ summary: 'Registrar cuenta bancaria de la empresa' })
  async createCuenta(
    @Body() dto: CreateCuentaBancariaDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.createCuentaBancaria(dto, user), 'Cuenta registrada');
  }

  // ── POST /pagos/mercadopago/preferencia — Link de pago ────
  @Post('mercadopago/preferencia')
  @RequirePermission('pagos:create')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Crear preferencia de pago MercadoPago',
    description: 'Genera una URL de pago a la que redirigir al cliente para pagar con MP.',
  })
  async crearPreferenciaMp(
    @Body() dto: CrearPreferenciaDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const preferencia = await this.svc.crearPreferenciaMp(dto, user);
    return StdResponse.ok(preferencia, 'Link de pago generado');
  }

  // ── POST /pagos/webhooks/mercadopago — Webhook (público) ──
  @Post('webhooks/mercadopago')
  @Public()    // No requiere JWT — viene de los servidores de MP
  @HttpCode(HttpStatus.OK)
  @SetMetadata('skipAudit', true)
  @ApiOperation({
    summary: 'Webhook de MercadoPago (endpoint público)',
    description:
      'Recibe notificaciones de MercadoPago. Verificado con HMAC-SHA256. ' +
      'No llamar manualmente.',
  })
  @ApiHeader({ name: 'x-signature',   description: 'Firma HMAC-SHA256 de MP', required: true })
  @ApiHeader({ name: 'x-request-id',  description: 'Request ID único de MP', required: true })
  async webhookMercadoPago(
    @Body()    body:       any,
    @Req()     req:        RawBodyRequest<Request>,
    @Headers('x-signature')  xSignature:  string,
    @Headers('x-request-id') xRequestId:  string,
  ) {
    this.logger.log(`Webhook MP: ${body.type} | action: ${body.action} | id: ${body.data?.id}`);

    await this.svc.procesarWebhookMercadoPago(
      body,
      req.rawBody || Buffer.from(JSON.stringify(body)),
      xSignature || '',
      xRequestId || '',
    );

    // MP espera HTTP 200 — si retornamos otro código lo reintenta
    return { received: true };
  }

  // ── GET /pagos/factura/:id — Pagos de una factura ────────
  @Get('factura/:facturaId')
  @RequirePermission('pagos:view')
  @SetMetadata('skipAudit', true)
  @ApiParam({ name: 'facturaId' })
  async findByFactura(
    @Param('facturaId', ParseUUIDPipe) facturaId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.findByFactura(facturaId, user.empresaId));
  }

  // ── GET /pagos/contrato/:id — Pagos de un contrato ───────
  @Get('contrato/:contratoId')
  @RequirePermission('pagos:view')
  @SetMetadata('skipAudit', true)
  @ApiParam({ name: 'contratoId' })
  async findByContrato(
    @Param('contratoId', ParseUUIDPipe) contratoId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.findByContrato(contratoId, user.empresaId));
  }

  // ── GET /pagos/cliente/:id — Pagos de un cliente ─────────
  @Get('cliente/:clienteId')
  @RequirePermission('pagos:view')
  @SetMetadata('skipAudit', true)
  @ApiParam({ name: 'clienteId' })
  async findByCliente(
    @Param('clienteId', ParseUUIDPipe) clienteId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.findByCliente(clienteId, user.empresaId));
  }

  // ── GET /pagos/:id — Obtener uno ─────────────────────────
  @Get(':id')
  @RequirePermission('pagos:view')
  @SetMetadata('skipAudit', true)
  @ApiParam({ name: 'id' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.findOne(id, user.empresaId));
  }

  // ── PATCH /pagos/:id/verificar — Aprobar / Rechazar ───────
  @Patch(':id/verificar')
  @RequirePermission('pagos:verify')
  @ApiOperation({
    summary: 'Verificar (aprobar o rechazar) un pago pendiente',
    description:
      'Al aprobar: aplica el pago a la factura y, si el contrato tenía mora ' +
      'y la deuda queda en cero, lo reactiva automáticamente sin intervención adicional.',
  })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 400, description: 'Pago ya verificado o rechazado' })
  async verificar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerificarPagoDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const pago = await this.svc.verificar(id, dto, user, req);
    return StdResponse.ok(pago,
      dto.aprobado
        ? 'Pago aprobado y aplicado — contrato reactivado si tenía mora'
        : 'Pago rechazado',
    );
  }

  // ── PATCH /pagos/:id/conciliar — Conciliar con extracto ──
  @Patch(':id/conciliar')
  @RequirePermission('pagos:conciliar')
  @ApiOperation({
    summary: 'Conciliar pago con extracto bancario',
    description: 'Marca el pago como conciliado con la referencia del extracto del banco.',
  })
  @ApiParam({ name: 'id' })
  async conciliar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConciliarPagoDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    return StdResponse.ok(await this.svc.conciliar(id, dto, user, req), 'Pago conciliado');
  }

  // ── POST /pagos/:id/comprobante — Subir foto del voucher ─
  @Post(':id/comprobante')
  @RequirePermission('pagos:create')
  @UseInterceptors(
    FileInterceptor('comprobante', {
      storage: memoryStorage(),
      limits:  { fileSize: 5 * 1024 * 1024 }, // 5MB
      fileFilter: (_, f, cb) => {
        const ok = ['image/jpeg','image/png','image/webp','application/pdf'].includes(f.mimetype);
        cb(ok ? null : new Error('Solo imágenes JPG/PNG/WebP o PDF'), ok);
      },
    }),
  )
  @ApiOperation({ summary: 'Subir foto del comprobante/voucher de pago' })
  @ApiConsumes('multipart/form-data')
  @ApiParam({ name: 'id' })
  async subirComprobante(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!file) throw new Error('No se recibió archivo');
    const pago = await this.svc.findOne(id, user.empresaId);
    const url  = await this.guardarComprobante(file, user.empresaId, id);
    // Actualizar URL del comprobante en el pago
    // (usamos el repo directamente para evitar recalcular lógica de negocio)
    return StdResponse.ok({ comprobanteUrl: url }, 'Comprobante subido');
  }

  private async guardarComprobante(
    file:      Express.Multer.File,
    empresaId: string,
    pagoId:    string,
  ): Promise<string> {
    const sharp  = await import('sharp');
    const fs     = await import('fs/promises');
    const path   = await import('path');
    const dir    = path.join(process.env.UPLOAD_DIR || '/app/uploads', 'comprobantes', empresaId);
    await fs.mkdir(dir, { recursive: true });

    const isPdf = file.mimetype === 'application/pdf';
    const ext   = isPdf ? 'pdf' : 'webp';
    const fname = `${pagoId}_${Date.now()}.${ext}`;
    const fpath = path.join(dir, fname);

    if (isPdf) {
      await fs.writeFile(fpath, file.buffer);
    } else {
      await sharp.default(file.buffer)
        .resize(1200, 900, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toFile(fpath);
    }

    return `/uploads/comprobantes/${empresaId}/${fname}`;
  }
}
