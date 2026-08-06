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
import { AdelantosService } from './adelantos.service';
import { CanalPagoService } from './canal-pago.service';
import { ArqueoCajaService } from './arqueo-caja.service';
import {
  RegistrarPagoDto, VerificarPagoDto, ConciliarPagoDto,
  ActualizarPagoDto, FilterPagoDto, CrearPreferenciaDto,
  CreateCuentaBancariaDto, ExtornarPagoDto,
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

  constructor(
    private readonly svc: PagosService,
    private readonly adelantosSvc: AdelantosService,
    private readonly canalSvc: CanalPagoService,
    private readonly arqueoSvc: ArqueoCajaService,
  ) {}

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

  // ── GET /pagos/canales — Canales de cobro configurados ────
  //
  // `soloManuales` deja fuera los que solo crea una pasarela (MercadoPago): ofrecerlos en
  // la caja permitiría registrar a mano un cobro que el webhook va a registrar solo, y el
  // ingreso acabaría contado dos veces.
  @Get('canales')
  @RequirePermission('pagos:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Canales de cobro activos (forma, cuenta sugerida, requisitos)' })
  async getCanales(
    @CurrentUser() user: JwtPayload,
    @Query('soloManuales') soloManuales?: string,
  ) {
    return StdResponse.ok(
      await this.canalSvc.listar(user.empresaId, soloManuales === 'true'),
    );
  }

  // ── Arqueo y cierre de caja ──────────────────────────────────
  //
  // El arqueo compara lo que el ERP dice que entró con lo que hay físicamente. La
  // diferencia se DECLARA: una caja que cuadra siempre no es una caja que cuadra, es una
  // donde el descuadre se absorbe en silencio.
  @Get('arqueo')
  @RequirePermission('cobranza:cerrar_caja')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Arqueo por cuenta receptora y cajero en un periodo' })
  async getArqueo(
    @CurrentUser() user: JwtPayload,
    @Query('desde') desde: string,
    @Query('hasta') hasta: string,
  ) {
    const hoy = new Date().toISOString().split('T')[0];
    return StdResponse.ok(
      await this.arqueoSvc.calcular(user.empresaId, desde || hoy, hasta || hoy),
    );
  }

  @Post('arqueo/cerrar')
  @RequirePermission('cobranza:cerrar_caja')
  @ApiOperation({
    summary: 'Cerrar caja',
    description: 'Registra lo contado. Si hay diferencia, la nota es obligatoria.',
  })
  async cerrarCaja(@Body() dto: any, @CurrentUser() user: JwtPayload, @Req() req: Request) {
    return StdResponse.ok(
      await this.arqueoSvc.cerrar(user.empresaId, dto, user, req), 'Caja cerrada',
    );
  }

  @Get('arqueo/historial')
  @RequirePermission('cobranza:cerrar_caja')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Cierres de caja anteriores' })
  async historialArqueo(@CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.arqueoSvc.historial(user.empresaId));
  }

  // ── GET /pagos/formas — Taxonomía cerrada ────────────────────
  @Get('formas')
  @RequirePermission('pagos:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Formas de pago (taxonomía cerrada, no configurable)' })
  async getFormas() {
    return StdResponse.ok(await this.canalSvc.formas());
  }

  // ── Ajustes de Cobranza: alta/edición/baja de canales ────────
  @Post('canales')
  @RequirePermission('cobranza:configurar')
  @ApiOperation({ summary: 'Crear canal de cobro' })
  async crearCanal(@Body() dto: any, @CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.canalSvc.crear(user.empresaId, dto), 'Canal creado');
  }

  @Patch('canales/:id')
  @RequirePermission('cobranza:configurar')
  @ApiOperation({ summary: 'Editar canal (el código y la forma son inmutables)' })
  async actualizarCanal(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(
      await this.canalSvc.actualizar(id, user.empresaId, dto), 'Canal actualizado',
    );
  }

  // Baja LÓGICA: el histórico tiene que seguir diciendo por dónde entró cada cobro.
  @Delete('canales/:id')
  @RequirePermission('cobranza:configurar')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Desactivar canal (baja lógica — nunca se borra)' })
  async desactivarCanal(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.canalSvc.desactivar(id, user.empresaId);
  }

  // ── GET /pagos/cuentas — Cuentas bancarias ────────────────
  @Get('cuentas')
  @RequirePermission('pagos:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Cuentas receptoras de la empresa (cajas y cuentas bancarias)' })
  async getCuentas(
    @CurrentUser() user: JwtPayload,
    @Query('incluirInactivas') incluirInactivas?: string,
  ) {
    return StdResponse.ok(
      await this.svc.getCuentasBancarias(user.empresaId, incluirInactivas === 'true'),
    );
  }

  // ── POST /pagos/cuentas — Alta de cuenta receptora ────────
  //
  // Cubre los dos casos: una CAJA (dinero físico, se arquea) y una cuenta bancaria (se
  // concilia contra el extracto). Antes solo admitía la segunda —`banco` y `numeroCuenta`
  // eran obligatorios—, así que "Caja Campo" no se podía dar de alta desde la aplicación.
  @Post('cuentas')
  @RequirePermission('cobranza:configurar')
  @ApiOperation({ summary: 'Registrar cuenta receptora (caja o cuenta bancaria)' })
  async createCuenta(
    @Body() dto: CreateCuentaBancariaDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.createCuentaBancaria(dto, user), 'Cuenta registrada');
  }

  // ── PATCH /pagos/cuentas/:id — Editar o dar de baja ───────
  // La baja es LÓGICA (`activa = false`): una cuenta con pagos históricos no se puede
  // borrar sin dejar esos cobros sin explicación de dónde entraron.
  @Patch('cuentas/:id')
  @RequirePermission('cobranza:configurar')
  @ApiOperation({ summary: 'Editar cuenta receptora (el tipo es inmutable)' })
  async actualizarCuenta(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(
      await this.svc.actualizarCuentaBancaria(id, dto, user), 'Cuenta actualizada',
    );
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

  // ── GET /pagos/adelantos — Listado de adelantos ───────────
  @Get('adelantos')
  @RequirePermission('pagos:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({
    summary: 'Adelantos de pago (saldo a favor)',
    description:
      'Pagos cobrados sin comprobante asignado. La situación (disponible / parcial / ' +
      'efectuado / devuelto) se deriva de lo aplicado, no es un estado guardado.',
  })
  async listarAdelantos(
    @Query('clienteId') clienteId: string | undefined,
    @Query('situacion') situacion: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(
      await this.adelantosSvc.listar(user.empresaId, { clienteId, situacion }),
    );
  }

  // ── GET /pagos/adelantos/saldo/:clienteId — Saldo a favor ─
  @Get('adelantos/saldo/:clienteId')
  @RequirePermission('pagos:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Saldo a favor disponible de un abonado' })
  @ApiParam({ name: 'clienteId' })
  async saldoAFavor(
    @Param('clienteId', ParseUUIDPipe) clienteId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const [saldo, deuda] = await Promise.all([
      this.adelantosSvc.saldoAFavor(clienteId, user.empresaId),
      this.adelantosSvc.deudaPendiente(clienteId, user.empresaId),
    ]);
    // `puedeAdelantar` viaja resuelto para que la UI no reimplemente la regla —y no se
    // desincronice de ella— al habilitar o bloquear el formulario.
    return StdResponse.ok({ ...saldo, deudaPendiente: deuda, puedeAdelantar: deuda <= 0 });
  }

  // ── POST /pagos/adelantos/:id/devolver — Devolver ─────────
  @Post('adelantos/:id/devolver')
  @RequirePermission('pagos:update')
  @ApiOperation({
    summary: 'Devolver un adelanto no consumido',
    description:
      'Solo se devuelve lo que aún no se aplicó a ningún comprobante. Si ya se aplicó, ' +
      'ese dinero pagó una deuda real y deshacerlo exige una nota de crédito.',
  })
  @ApiParam({ name: 'id' })
  async devolverAdelanto(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { motivo: string },
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    return StdResponse.ok(await this.adelantosSvc.devolver(id, body?.motivo, user, req));
  }

  // ── GET /pagos/cliente-deuda/:clienteId — Verificar deuda ─
  @Get('cliente-deuda/:clienteId')
  @RequirePermission('pagos:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({
    summary: 'Verificar si un cliente tiene deudas pendientes',
    description:
      'Devuelve { tieneDeuda, count, totalPendiente }. ' +
      'Usado por el frontend para habilitar/bloquear el formulario de pago.',
  })
  @ApiParam({ name: 'clienteId' })
  async verificarDeudaCliente(
    @Param('clienteId', ParseUUIDPipe) clienteId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(
      await this.svc.verificarDeudaCliente(clienteId, user.empresaId),
    );
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

  // ── PATCH /pagos/:id — Editar metadatos ──────────────────────
  @Patch(':id')
  @RequirePermission('pagos:update')
  @ApiOperation({ summary: 'Editar metadatos de un pago (método, banco, fecha, N° operación, notas)' })
  @ApiParam({ name: 'id' })
  async actualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActualizarPagoDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const pago = await this.svc.actualizar(id, dto, user.empresaId, user, req);
    return StdResponse.ok(pago, 'Pago actualizado');
  }

  // ── POST /pagos/:id/extornar — Anular un cobro ───────────────
  //
  // Sustituye al DELETE. Un pago registrado es un hecho histórico: se anula, no se borra.
  // El motivo es obligatorio porque decide si el dinero vuelve al abonado y si cortarle
  // el servicio es legítimo o es un error nuestro.
  @Post(':id/extornar')
  @RequirePermission('pagos:extornar')
  @ApiOperation({
    summary: 'Extornar (anular) un pago',
    description:
      'Retira la imputación del pago y recalcula el saldo de los comprobantes afectados. ' +
      'NO corta el servicio: la deuda vuelve a existir y el corte lo decide el ciclo de ' +
      'cobranza con su periodo de gracia.',
  })
  @ApiParam({ name: 'id' })
  async extornar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExtornarPagoDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const pago = await this.svc.extornar(id, dto, user, req);
    return StdResponse.ok(pago, 'Pago extornado. La deuda del abonado vuelve a estar vigente.');
  }

  // ── DELETE /pagos/:id — retirado ─────────────────────────────
  // Se conserva la ruta para responder con el motivo en vez de un 404 despistante: quien
  // la llame se lleva una explicación y la ruta correcta.
  @Delete(':id')
  @RequirePermission('pagos:delete')
  @ApiOperation({ summary: 'RETIRADO — usa POST /pagos/:id/extornar' })
  @ApiParam({ name: 'id' })
  async eliminar(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.svc.eliminar(id, user.empresaId, user);
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
