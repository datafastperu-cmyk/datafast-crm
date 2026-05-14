import {
  Injectable, Logger, NotFoundException,
  BadRequestException, ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { FacturaRepository } from './repositories/factura.repository';
import { PdfService, EmpresaPdfData, ClientePdfData } from './pdf.service';
import { AuditoriaService } from '../auth/auditoria.service';
import { JwtPayload } from '../../common/decorators/current-user.decorator';

import {
  Factura, EstadoFactura, TipoComprobante, ItemFactura,
} from './entities/factura.entity';
import {
  CreateFacturaDto, GenerarFacturasMensualesDto,
  CreateNotaCreditoDto, AnularFacturaDto, FilterFacturaDto,
  ResumenFinancieroDto,
} from './dto/factura.dto';
import { formatPaginatedResponse } from '../../common/utils/pagination.util';

// ─── Resultado de generación masiva ──────────────────────────
export interface ResultadoGeneracion {
  total:     number;
  exitosas:  number;
  omitidas:  number;
  errores:   number;
  detalles:  Array<{ contratoId: string; numeroContrato: string; resultado: string; error?: string }>;
}

@Injectable()
export class FacturacionService {
  private readonly logger = new Logger(FacturacionService.name);

  constructor(
    private readonly facturaRepo: FacturaRepository,
    private readonly pdfSvc:      PdfService,
    private readonly auditoria:   AuditoriaService,
    private readonly config:      ConfigService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  // ────────────────────────────────────────────────────────────
  // CREAR FACTURA MANUAL
  // ────────────────────────────────────────────────────────────
  async create(
    dto: CreateFacturaDto,
    user: JwtPayload,
    req?: any,
  ): Promise<Factura> {
    // Calcular montos con IGV
    const { subtotal, descuento, igv, total, items } =
      await this.calcularMontos(dto, user.empresaId);

    // Obtener serie y correlativo
    const { serie, correlativo } = await this.obtenerSerieCorrelativo(
      user.empresaId,
      dto.tipoComprobante || TipoComprobante.BOLETA,
    );

    // Fecha de vencimiento por defecto
    const fechaVencimiento =
      dto.fechaVencimiento || this.calcularFechaVencimiento(user.empresaId);

    const factura = this.facturaRepo.create({
      empresaId:              user.empresaId,
      clienteId:              dto.clienteId,
      contratoId:             dto.contratoId,
      tipoComprobante:        dto.tipoComprobante || TipoComprobante.BOLETA,
      serie,
      correlativo,
      periodoInicio:          dto.periodoInicio,
      periodoFin:             dto.periodoFin,
      descripcion:            dto.descripcion || 'Servicio de internet',
      subtotal,
      descuento,
      igv,
      total,
      montoPagado:            0,
      items,
      estado:                 EstadoFactura.EMITIDA,
      fechaEmision:           new Date().toISOString().split('T')[0],
      fechaVencimiento,
      moneda:                 dto.moneda || 'PEN',
      generadaAutomaticamente: false,
      createdBy:              user.sub,
    });

    const saved = await this.facturaRepo.save(factura);

    // Generar PDF de forma asíncrona
    this.generarPdfAsync(saved, user.empresaId);

    await this.auditoria.logCreate({
      empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      modulo: 'facturacion', entidadId: saved.id,
      descripcion: `Factura ${serie}-${correlativo} · Cliente: ${dto.clienteId} · Total: ${total}`, req,
    });

    this.logger.log(`Factura creada: ${serie}-${correlativo} | total: ${total} | empresa: ${user.empresaId}`);
    return saved;
  }

  // ────────────────────────────────────────────────────────────
  // GENERACIÓN MASIVA MENSUAL
  // Crea facturas para todos los contratos activos de la empresa.
  // Idempotente: omite contratos ya facturados en el periodo.
  // ────────────────────────────────────────────────────────────
  async generarMensual(
    dto: GenerarFacturasMensualesDto,
    user: JwtPayload,
    req?: any,
  ): Promise<ResultadoGeneracion> {
    const hoy     = new Date();
    const mes     = dto.mes  ?? hoy.getMonth() + 1;
    const anio    = dto.anio ?? hoy.getFullYear();

    this.logger.log(
      `Generación mensual: ${anio}/${mes} | empresa: ${user.empresaId} | usuario: ${user.email}`,
    );

    // Obtener todos los contratos activos con sus datos de cliente y empresa
    const contratos = await this.facturaRepo.findContratosParaFacturar(
      user.empresaId, mes, anio, dto.contratoId,
    );

    if (!contratos.length) {
      return { total: 0, exitosas: 0, omitidas: 0, errores: 0, detalles: [] };
    }

    const resultado: ResultadoGeneracion = {
      total:    contratos.length,
      exitosas: 0, omitidas: 0, errores: 0,
      detalles: [],
    };

    const tipoComprobante = dto.tipoComprobante || TipoComprobante.BOLETA;
    const igvRate  = parseFloat(contratos[0]?.igv_rate || '0.18');
    const diasGracia = parseInt(contratos[0]?.dias_gracia || '5', 10);

    for (const contrato of contratos) {
      try {
        // Calcular periodo del mes a facturar
        const periodoInicio = `${anio}-${String(mes).padStart(2, '0')}-01`;
        const periodoFin    = this.ultimoDiaMes(anio, mes);

        // Verificar si ya existe factura para este periodo
        const yaFacturado = await this.facturaRepo.existeFacturaPeriodo(
          contrato.contrato_id, periodoInicio, periodoFin,
        );

        if (yaFacturado) {
          resultado.omitidas++;
          resultado.detalles.push({
            contratoId:     contrato.contrato_id,
            numeroContrato: contrato.numero_contrato,
            resultado:      'omitida — ya facturado este periodo',
          });
          continue;
        }

        // Calcular montos
        const precioBase = parseFloat(contrato.precio || '0');
        const aplicaIgv  = contrato.aplica_igv === true || contrato.aplica_igv === 'true';

        const { subtotal, descuento, igv, total } = this.calcularMontosDesdeBase(
          precioBase, 0, aplicaIgv, igvRate,
        );

        // Obtener serie y correlativo
        const { serie, correlativo } = await this.obtenerSerieCorrelativo(
          user.empresaId, tipoComprobante,
        );

        // Fecha de vencimiento
        const diaVenc = parseInt(contrato.dia_facturacion || '1', 10) + diasGracia;
        const fechaVencimiento = `${anio}-${String(mes).padStart(2, '0')}-${String(Math.min(diaVenc, 28)).padStart(2, '0')}`;

        const factura = this.facturaRepo.create({
          empresaId:               user.empresaId,
          clienteId:               contrato.cliente_id,
          contratoId:              contrato.contrato_id,
          tipoComprobante,
          serie,
          correlativo,
          periodoInicio,
          periodoFin,
          descripcion:             `Servicio de internet ${contrato.plan_nombre} — ${this.mesNombre(mes)} ${anio}`,
          subtotal,
          descuento: 0,
          igv,
          total,
          montoPagado:             0,
          items:                   this.buildItemsDesdeContrato(contrato, mes, anio),
          estado:                  EstadoFactura.EMITIDA,
          fechaEmision:            new Date().toISOString().split('T')[0],
          fechaVencimiento,
          moneda:                  'PEN',
          generadaAutomaticamente: true,
          createdBy:               user.sub,
        });

        const saved = await this.facturaRepo.save(factura);

        // PDF asíncrono
        this.generarPdfAsync(saved, user.empresaId, {
          razonSocial:     contrato.empresa_nombre,
          ruc:             contrato.empresa_ruc,
          direccionFiscal: contrato.empresa_direccion,
        }, {
          nombreCompleto:  contrato.cliente_nombre,
          tipoDocumento:   contrato.tipo_documento,
          numeroDocumento: contrato.cliente_documento,
          direccion:       contrato.cliente_direccion,
          email:           contrato.cliente_email,
          telefono:        contrato.cliente_telefono,
        });

        resultado.exitosas++;
        resultado.detalles.push({
          contratoId:     contrato.contrato_id,
          numeroContrato: contrato.numero_contrato,
          resultado:      `generada: ${serie}-${correlativo} | total: S/ ${total.toFixed(2)}`,
        });

      } catch (err) {
        resultado.errores++;
        resultado.detalles.push({
          contratoId:     contrato.contrato_id,
          numeroContrato: contrato.numero_contrato,
          resultado:      'error',
          error:          err.message,
        });
        this.logger.error(
          `Error generando factura para contrato ${contrato.numero_contrato}: ${err.message}`,
        );
      }
    }

    await this.auditoria.log({
      empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      accion: 'GENERATE_MONTHLY', modulo: 'facturacion',
      descripcion: `Generación mensual ${mes}/${anio}: ${resultado.exitosas} exitosas, ${resultado.omitidas} omitidas, ${resultado.errores} errores`,
      req,
    });

    this.logger.log(
      `Generación ${mes}/${anio} completada: ${resultado.exitosas}/${resultado.total} facturas`,
    );
    return resultado;
  }

  // ────────────────────────────────────────────────────────────
  // ANULAR FACTURA (con opción de nota de crédito automática)
  // ────────────────────────────────────────────────────────────
  async anular(
    id: string,
    dto: AnularFacturaDto,
    user: JwtPayload,
    req?: any,
  ): Promise<{ factura: Factura; notaCredito?: Factura }> {
    const factura = await this.findOne(id, user.empresaId);

    if (factura.estado === EstadoFactura.ANULADA) {
      throw new BadRequestException('La factura ya está anulada');
    }

    if (factura.estado === EstadoFactura.PAGADA) {
      throw new BadRequestException(
        'No se puede anular una factura pagada. Emite una nota de crédito.',
      );
    }

    // Anular la factura
    await this.facturaRepo.update(id, {
      estado:          EstadoFactura.ANULADA,
      motivoAnulacion: dto.motivo,
      anuladaEn:       new Date(),
      anuladaPor:      user.sub,
    });

    const facturaAnulada = await this.findOne(id, user.empresaId);

    // Regenerar PDF con watermark ANULADO
    this.generarPdfAsync(facturaAnulada, user.empresaId);

    await this.auditoria.logUpdate({
      empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      modulo: 'facturacion', entidadId: id,
      descripcion: `Factura ${facturaAnulada.numeroCompleto} anulada: ${dto.motivo}`, req,
    });

    // Crear nota de crédito si se solicitó
    let notaCredito: Factura | undefined;
    if (dto.crearNotaCredito !== false) {
      notaCredito = await this.crearNotaCredito(
        { facturaOriginalId: id, motivo: dto.motivo },
        user, req,
      );
    }

    return { factura: facturaAnulada, notaCredito };
  }

  // ────────────────────────────────────────────────────────────
  // NOTA DE CRÉDITO
  // ────────────────────────────────────────────────────────────
  async crearNotaCredito(
    dto: CreateNotaCreditoDto,
    user: JwtPayload,
    req?: any,
  ): Promise<Factura> {
    const original = await this.findOne(dto.facturaOriginalId, user.empresaId);

    if (original.tipoComprobante === TipoComprobante.NOTA_CREDITO) {
      throw new BadRequestException('No se puede emitir una nota de crédito de otra nota de crédito');
    }

    const montoAcreditar = dto.montoAcreditar ?? Number(original.total);
    const igvRate        = this.getIgvRate();
    const aplicaIgv      = Number(original.igv) > 0;

    const { subtotal, igv, total } = this.calcularMontosDesdeBase(
      montoAcreditar, 0, aplicaIgv, igvRate,
    );

    const { serie, correlativo } = await this.obtenerSerieCorrelativo(
      user.empresaId, TipoComprobante.NOTA_CREDITO,
    );

    // La serie de nota de crédito suele ser 'BC01' o 'FC01' según el tipo original
    const serieNc = original.tipoComprobante === TipoComprobante.FACTURA ? 'FC01' : 'BC01';
    const correlativoNc = await this.facturaRepo.siguienteCorrelativo(user.empresaId, serieNc);

    const nc = this.facturaRepo.create({
      empresaId:        user.empresaId,
      clienteId:        original.clienteId,
      contratoId:       original.contratoId,
      tipoComprobante:  TipoComprobante.NOTA_CREDITO,
      serie:            serieNc,
      correlativo:      correlativoNc,
      periodoInicio:    original.periodoInicio,
      periodoFin:       original.periodoFin,
      descripcion:      `Nota de crédito por: ${dto.motivo} — Ref: ${original.numeroCompleto}`,
      subtotal,
      descuento:        0,
      igv,
      total,
      montoPagado:      0,
      items: [{
        descripcion:    `Anulación/rectificación de ${original.numeroCompleto}: ${dto.motivo}`,
        cantidad:       1,
        precioUnitario: subtotal,
        subtotal,
      }],
      estado:           EstadoFactura.EMITIDA,
      fechaEmision:     new Date().toISOString().split('T')[0],
      fechaVencimiento: new Date().toISOString().split('T')[0],
      moneda:           original.moneda,
      facturaOriginalId: original.id,
      generadaAutomaticamente: false,
      createdBy:        user.sub,
    });

    const saved = await this.facturaRepo.save(nc);
    this.generarPdfAsync(saved, user.empresaId);

    this.logger.log(`Nota de crédito ${serieNc}-${correlativoNc} emitida ref: ${original.numeroCompleto}`);
    return saved;
  }

  // ────────────────────────────────────────────────────────────
  // MARCAR VENCIDAS (ejecutado por el worker de crons)
  // ────────────────────────────────────────────────────────────
  async marcarVencidas(): Promise<number> {
    const vencidas = await this.facturaRepo.findFacturasParaVencer();

    let count = 0;
    for (const f of vencidas) {
      await this.facturaRepo.update(f.id, { estado: EstadoFactura.VENCIDA });
      count++;
    }

    if (count > 0) {
      this.logger.log(`Facturas marcadas como vencidas: ${count}`);
    }
    return count;
  }

  // ────────────────────────────────────────────────────────────
  // APLICAR PAGO A FACTURA
  // Llamado desde el módulo de Pagos al registrar un pago.
  // ────────────────────────────────────────────────────────────
  async aplicarPago(
    facturaId: string,
    montoPago: number,
    empresaId: string,
    fechaPago: string,
  ): Promise<Factura> {
    const factura = await this.findOne(facturaId, empresaId);

    if (factura.estado === EstadoFactura.ANULADA) {
      throw new BadRequestException('No se puede aplicar un pago a una factura anulada');
    }
    if (factura.estado === EstadoFactura.PAGADA) {
      throw new BadRequestException('La factura ya está pagada');
    }

    const nuevoMontoPagado = Number(factura.montoPagado) + montoPago;
    const nuevoSaldo       = Number(factura.total) - nuevoMontoPagado;
    const nuevoEstado = nuevoSaldo <= 0
      ? EstadoFactura.PAGADA
      : EstadoFactura.PAGADA_PARCIAL;

    await this.facturaRepo.update(facturaId, {
      montoPagado: nuevoMontoPagado,
      estado:      nuevoEstado,
      fechaPago:   nuevoSaldo <= 0 ? fechaPago : factura.fechaPago,
    });

    const actualizada = await this.findOne(facturaId, empresaId);

    // Si se pagó completo, regenerar PDF con badge PAGADA
    if (nuevoEstado === EstadoFactura.PAGADA) {
      this.generarPdfAsync(actualizada, empresaId);
    }

    return actualizada;
  }

  // ────────────────────────────────────────────────────────────
  // REGENERAR PDF
  // ────────────────────────────────────────────────────────────
  async regenerarPdf(id: string, empresaId: string): Promise<Factura> {
    const factura = await this.findOne(id, empresaId);
    await this.generarPdfAsync(factura, empresaId);
    return this.findOne(id, empresaId);
  }

  // ────────────────────────────────────────────────────────────
  // LISTAR / OBTENER
  // ────────────────────────────────────────────────────────────
  async findAll(empresaId: string, filters: FilterFacturaDto) {
    const result = await this.facturaRepo.findAllPaginated(empresaId, filters);
    return formatPaginatedResponse(result);
  }

  async findOne(id: string, empresaId: string): Promise<Factura> {
    const f = await this.facturaRepo.findById(id, empresaId);
    if (!f) throw new NotFoundException(`Factura ${id} no encontrada`);
    return f;
  }

  async findByContrato(contratoId: string, empresaId: string): Promise<Factura[]> {
    return this.facturaRepo.findByContrato(contratoId, empresaId);
  }

  async findByCliente(clienteId: string, empresaId: string): Promise<Factura[]> {
    return this.facturaRepo.findByCliente(clienteId, empresaId);
  }

  async getResumenFinanciero(empresaId: string): Promise<ResumenFinancieroDto> {
    const raw = await this.facturaRepo.getResumenFinanciero(empresaId);
    const facturadoMes = parseFloat(raw.facturado_mes || '0');
    const cobradoMes   = parseFloat(raw.cobrado_mes   || '0');
    return {
      facturadoMes,
      cobradoMes,
      cobradoHoy:          parseFloat(raw.cobrado_hoy          || '0'),
      cobradoMesAnterior:  parseFloat(raw.cobrado_mes_anterior  || '0'),
      cuentasPorCobrar:    parseFloat(raw.cuentas_por_cobrar    || '0'),
      facturasVencidas:    parseInt(raw.facturas_vencidas        || '0', 10),
      totalEmitidas:       parseInt(raw.total_emitidas           || '0', 10),
      totalPagadas:        parseInt(raw.total_pagadas            || '0', 10),
      totalAnuladas:       parseInt(raw.total_anuladas           || '0', 10),
      tasaCobranza: facturadoMes > 0 ? Math.round((cobradoMes / facturadoMes) * 100) : 0,
    };
  }

  async getPendientesPorContrato(contratoId: string): Promise<Factura[]> {
    return this.facturaRepo.findPendientesPorContrato(contratoId);
  }

  // ────────────────────────────────────────────────────────────
  // HELPERS PRIVADOS
  // ────────────────────────────────────────────────────────────

  // Calcular montos desde DTO (puede tener items o subtotal directo)
  private async calcularMontos(
    dto: CreateFacturaDto,
    empresaId: string,
  ): Promise<{ subtotal: number; descuento: number; igv: number; total: number; items: ItemFactura[] }> {
    const igvRate  = this.getIgvRate();
    const aplicaIgv = dto.aplicaIgv !== false;
    let subtotal   = 0;
    let items: ItemFactura[] = [];

    if (dto.items?.length) {
      // Calcular desde items
      items = dto.items.map((item) => {
        const sub = item.cantidad * item.precioUnitario - (item.descuento || 0);
        return { ...item, subtotal: Math.round(sub * 100) / 100 };
      });
      subtotal = items.reduce((acc, i) => acc + i.subtotal, 0);
    } else if (dto.subtotal !== undefined) {
      subtotal = dto.subtotal;
    } else {
      throw new BadRequestException('Debe proporcionar items o subtotal');
    }

    const descuento = dto.descuento || 0;
    return this.calcularMontosDesdeBase(subtotal, descuento, aplicaIgv, igvRate, items);
  }

  // Calcular IGV y total desde base
  private calcularMontosDesdeBase(
    subtotal:   number,
    descuento:  number,
    aplicaIgv:  boolean,
    igvRate:    number,
    items:      ItemFactura[] = [],
  ): { subtotal: number; descuento: number; igv: number; total: number; items: ItemFactura[] } {
    const baseImponible = Math.max(0, subtotal - descuento);

    let igv:   number;
    let total: number;

    if (aplicaIgv) {
      // Precio incluye IGV (modelo peruano típico):
      // precio_con_igv = base * (1 + igvRate)
      igv   = Math.round(baseImponible * igvRate * 100) / 100;
      total = Math.round((baseImponible + igv) * 100) / 100;
    } else {
      igv   = 0;
      total = Math.round(baseImponible * 100) / 100;
    }

    return {
      subtotal: Math.round(subtotal * 100) / 100,
      descuento: Math.round(descuento * 100) / 100,
      igv,
      total,
      items,
    };
  }

  // Obtener serie y siguiente correlativo de forma atómica
  private async obtenerSerieCorrelativo(
    empresaId: string,
    tipo: TipoComprobante,
  ): Promise<{ serie: string; correlativo: number }> {
    // Obtener serie de la empresa desde BD
    const [empresa] = await this.ds.query(
      'SELECT serie_boleta, serie_factura FROM empresas WHERE id = $1',
      [empresaId],
    );

    let serie: string;
    switch (tipo) {
      case TipoComprobante.FACTURA:      serie = empresa?.serie_factura || 'F001'; break;
      case TipoComprobante.NOTA_CREDITO: serie = 'BC01'; break;
      case TipoComprobante.NOTA_DEBITO:  serie = 'BD01'; break;
      case TipoComprobante.RECIBO_INTERNO: serie = 'REC'; break;
      default:                            serie = empresa?.serie_boleta || 'B001';
    }

    const correlativo = await this.facturaRepo.siguienteCorrelativo(empresaId, serie);
    return { serie, correlativo };
  }

  // Calcular fecha de vencimiento por defecto
  private calcularFechaVencimiento(empresaId: string): string {
    const diasGracia = this.config.get<number>('app.billing.graceDays', 5);
    const fecha = new Date();
    fecha.setDate(fecha.getDate() + diasGracia);
    return fecha.toISOString().split('T')[0];
  }

  private getIgvRate(): number {
    return this.config.get<number>('app.billing.igvRate', 0.18);
  }

  private ultimoDiaMes(anio: number, mes: number): string {
    const ultimo = new Date(anio, mes, 0).getDate();
    return `${anio}-${String(mes).padStart(2, '0')}-${ultimo}`;
  }

  private mesNombre(mes: number): string {
    const nombres = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio',
                     'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    return nombres[mes] || '';
  }

  private buildItemsDesdeContrato(contrato: any, mes: number, anio: number): ItemFactura[] {
    return [{
      descripcion:    `${contrato.plan_nombre} — ${this.mesNombre(mes)} ${anio}`,
      cantidad:       1,
      precioUnitario: parseFloat(contrato.precio || '0'),
      descuento:      0,
      subtotal:       parseFloat(contrato.precio || '0'),
    }];
  }

  // Generar PDF de forma no bloqueante
  private generarPdfAsync(
    factura: Factura,
    empresaId: string,
    empresaOverride?: Partial<EmpresaPdfData>,
    clienteOverride?: Partial<ClientePdfData>,
  ): void {
    // Cargar datos frescos si no se proveen overrides
    this.ds.query(
      `SELECT em.razon_social, em.ruc, em.direccion_fiscal, em.telefono, em.email,
              cl.nombre_completo, cl.tipo_documento, cl.numero_documento,
              cl.direccion, cl.email AS cl_email, cl.telefono AS cl_telefono,
              cl.es_empresa, cl.ruc_empresa, cl.razon_social AS cl_razon_social
       FROM facturas f
       JOIN empresas em ON em.id = f.empresa_id
       JOIN clientes cl ON cl.id = f.cliente_id
       WHERE f.id = $1`,
      [factura.id],
    ).then(([row]) => {
      if (!row) return;

      const empresa: EmpresaPdfData = {
        razonSocial:     empresaOverride?.razonSocial  || row.razon_social,
        ruc:             empresaOverride?.ruc           || row.ruc,
        direccionFiscal: empresaOverride?.direccionFiscal || row.direccion_fiscal,
        telefono:        row.telefono,
        email:           row.email,
      };

      const cliente: ClientePdfData = {
        nombreCompleto:  clienteOverride?.nombreCompleto  || row.nombre_completo,
        tipoDocumento:   clienteOverride?.tipoDocumento   || row.tipo_documento,
        numeroDocumento: clienteOverride?.numeroDocumento || row.numero_documento,
        direccion:       clienteOverride?.direccion       || row.direccion,
        email:           clienteOverride?.email           || row.cl_email,
        telefono:        clienteOverride?.telefono        || row.cl_telefono,
        esEmpresa:       row.es_empresa,
        rucEmpresa:      row.ruc_empresa,
        razonSocial:     row.cl_razon_social,
      };

      return this.pdfSvc.generarFacturaPdf(factura, empresa, cliente);
    })
    .then((pdfUrl) => {
      if (pdfUrl) {
        return this.facturaRepo.update(factura.id, {
          pdfUrl,
          pdfGeneradoEn: new Date(),
        });
      }
    })
    .catch((err) => {
      this.logger.error(`Error generando PDF para factura ${factura.id}: ${err.message}`);
    });
  }
}
