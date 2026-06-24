import {
  Injectable, Logger, NotFoundException,
  BadRequestException, ConflictException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { FacturaRepository }          from './repositories/factura.repository';
import { ComprobantesConfigService }   from './comprobantes-config.service';
import { PdfService, EmpresaPdfData, ClientePdfData } from './pdf.service';
import { AuditoriaService }            from '../auth/auditoria.service';
import { JwtPayload }                  from '../../common/decorators/current-user.decorator';

import { Factura, EstadoFactura, ItemFactura } from './entities/factura.entity';
import { CargoPendiente }              from './entities/cargo-pendiente.entity';
import { ComprobanteConfig }           from './entities/comprobante-config.entity';
import {
  CreateFacturaDto, GenerarFacturasMensualesDto,
  CreateNotaCreditoDto, AnularFacturaDto, FilterFacturaDto,
  ResumenFinancieroDto, UpdateFacturaDto,
} from './dto/factura.dto';
import { formatPaginatedResponse } from '../../common/utils/pagination.util';

export interface ResultadoGeneracion {
  total:    number;
  exitosas: number;
  omitidas: number;
  errores:  number;
  detalles: Array<{ contratoId: string; numeroContrato: string; resultado: string; error?: string }>;
}

@Injectable()
export class FacturacionService {
  private readonly logger = new Logger(FacturacionService.name);

  constructor(
    private readonly facturaRepo:    FacturaRepository,
    private readonly comprobantesSvc: ComprobantesConfigService,
    private readonly pdfSvc:         PdfService,
    private readonly auditoria:      AuditoriaService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  // ────────────────────────────────────────────────────────────
  // CREAR FACTURA MANUAL
  // ────────────────────────────────────────────────────────────
  async create(dto: CreateFacturaDto, user: JwtPayload, req?: any): Promise<Factura> {
    // Resolver comprobante: si el DTO trae comprobanteConfigId lo usa,
    // sino resuelve por jerarquía (cliente → empresa default → primer activo)
    const comprobanteConfig = dto.comprobanteConfigId
      ? await this.getComprobanteById(dto.comprobanteConfigId, user.empresaId)
      : await this.comprobantesSvc.resolverParaCliente(user.empresaId, dto.clienteId);

    // Configuración global para saber igvRate y moneda
    const configGlobal = await this.comprobantesSvc.getConfiguracion(user.empresaId);

    if (dto.periodoInicio >= dto.periodoFin) {
      throw new BadRequestException('periodoFin debe ser posterior a periodoInicio');
    }

    const { subtotal, descuento, igv, total, items } =
      await this.calcularMontos(dto, comprobanteConfig, configGlobal.igvRate);

    const { correlativo } =
      await this.comprobantesSvc.siguienteCorrelativo(comprobanteConfig.id);
    const serie = comprobanteConfig.serie;

    const [emRow] = await this.ds.query<{ dias_gracia: string }[]>(
      'SELECT dias_gracia FROM empresas WHERE id = $1 AND deleted_at IS NULL',
      [user.empresaId],
    );
    const fechaVencimiento =
      dto.fechaVencimiento || this.calcularFechaVencimiento(parseInt(emRow?.dias_gracia || '5', 10));

    const factura = this.facturaRepo.create({
      empresaId:            user.empresaId,
      clienteId:            dto.clienteId,
      contratoId:           dto.contratoId,
      comprobanteConfigId:  comprobanteConfig.id,
      tipoComprobante:      comprobanteConfig.codigo,
      tipoComprobanteNombre: comprobanteConfig.nombre,
      tieneCargaFiscal:     comprobanteConfig.tieneCargaFiscal,
      serie,
      correlativo,
      periodoInicio:        dto.periodoInicio,
      periodoFin:           dto.periodoFin,
      descripcion:          dto.descripcion || 'Servicio de internet',
      subtotal, descuento, igv, total,
      montoPagado:          0,
      items,
      estado:               EstadoFactura.EMITIDA,
      fechaEmision:         new Date().toISOString().split('T')[0],
      fechaVencimiento,
      moneda:               configGlobal.moneda,
      generadaAutomaticamente: false,
      createdBy:            user.sub,
    });

    const saved = await this.facturaRepo.save(factura);
    this.generarPdfAsync(saved, user.empresaId);

    await this.auditoria.logCreate({
      empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      modulo: 'facturacion', entidadId: saved.id,
      descripcion: `${comprobanteConfig.nombre} ${serie}-${correlativo} · Cliente: ${dto.clienteId} · Total: ${total}`,
      req,
    });

    return saved;
  }

  // ────────────────────────────────────────────────────────────
  // GENERACIÓN MASIVA MENSUAL
  // Idempotente: omite clientes ya facturados en el periodo.
  // Resuelve el tipo de comprobante por cliente individualmente.
  // ────────────────────────────────────────────────────────────
  async generarMensual(
    dto: GenerarFacturasMensualesDto,
    user: JwtPayload,
    req?: any,
  ): Promise<ResultadoGeneracion> {
    const hoy  = new Date();
    const mes  = dto.mes  ?? hoy.getMonth() + 1;
    const anio = dto.anio ?? hoy.getFullYear();

    this.logger.log(`Generación mensual: ${anio}/${mes} | empresa: ${user.empresaId}`);

    const configGlobal = await this.comprobantesSvc.getConfiguracion(user.empresaId);
    const contratos    = await this.facturaRepo.findContratosParaFacturar(user.empresaId, mes, anio, dto.contratoId);

    if (!contratos.length) {
      return { total: 0, exitosas: 0, omitidas: 0, errores: 0, detalles: [] };
    }

    // Agrupar por cliente
    const porCliente = new Map<string, typeof contratos>();
    for (const c of contratos) {
      if (!porCliente.has(c.cliente_id)) porCliente.set(c.cliente_id, []);
      porCliente.get(c.cliente_id)!.push(c);
    }

    const resultado: ResultadoGeneracion = {
      total: porCliente.size, exitosas: 0, omitidas: 0, errores: 0, detalles: [],
    };

    const periodoInicio = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const periodoFin    = this.ultimoDiaMes(anio, mes);

    for (const [clienteId, grupo] of porCliente) {
      const primer = grupo[0];
      try {
        const yaFacturado = await this.facturaRepo.existeFacturaClientePeriodo(
          clienteId, periodoInicio, periodoFin,
        );
        if (yaFacturado) {
          resultado.omitidas++;
          grupo.forEach(c => resultado.detalles.push({
            contratoId: c.contrato_id, numeroContrato: c.numero_contrato,
            resultado:  'omitida — ya facturado este periodo',
          }));
          continue;
        }

        // Resolver comprobante por jerarquía para este cliente específico
        const comprobante = await this.comprobantesSvc.resolverParaCliente(user.empresaId, clienteId);

        // Leer IGV y días de gracia por contrato (no del primer elemento del lote)
        const aplicaIgv  = comprobante.tieneCargaFiscal;
        const igvRate    = Number(configGlobal.igvRate);
        const diasGracia = parseInt(primer.dias_gracia || '5', 10);

        let totalSubtotal = 0, totalIgv = 0, totalTotal = 0;
        const items: ItemFactura[] = [];

        for (const contrato of grupo) {
          const precioBase = parseFloat(contrato.precio || '0');
          // IGV leído de configGlobal, no del primer contrato del lote
          const contratoAplicaIgv = comprobante.tieneCargaFiscal &&
            (contrato.aplica_igv === true || contrato.aplica_igv === 'true');

          const { subtotal: sub, igv: igvItem, total: tot } =
            this.calcularMontosDesdeBase(precioBase, 0, contratoAplicaIgv, igvRate);

          items.push({
            descripcion:    `${contrato.plan_nombre} — ${this.mesNombre(mes)} ${anio}`,
            cantidad:       1,
            precioUnitario: sub,
            descuento:      0,
            subtotal:       sub,
            tipoItem:       'servicio',
          });
          totalSubtotal += sub;
          totalIgv      += igvItem;
          totalTotal    += tot;
        }

        // Agregar cargos pendientes (mora/reconexión de ciclos anteriores)
        const cargosPendientes = await this.consumirCargosPendientes(clienteId, user.empresaId, igvRate);
        for (const cargo of cargosPendientes.items) {
          items.push(cargo);
          totalSubtotal += cargo.subtotal;
          totalIgv      += cargo.igvItem ?? 0;
          totalTotal    += cargo.total;
        }

        totalSubtotal = Math.round(totalSubtotal * 100) / 100;
        totalIgv      = Math.round(totalIgv      * 100) / 100;
        totalTotal    = Math.round(totalTotal     * 100) / 100;

        const { correlativo } = await this.comprobantesSvc.siguienteCorrelativo(comprobante.id);
        const serie = comprobante.serie;

        const diaFact         = parseInt(primer.dia_facturacion || '1', 10);
        const vencimientoDate = new Date(anio, mes - 1, diaFact + diasGracia);
        const fechaVencimiento = vencimientoDate.toISOString().split('T')[0];
        const descripcion = grupo.length === 1
          ? `${comprobante.nombre} — ${primer.plan_nombre} · ${this.mesNombre(mes)} ${anio}`
          : `${comprobante.nombre} — Servicios contratados · ${this.mesNombre(mes)} ${anio}`;

        const factura = this.facturaRepo.create({
          empresaId:               user.empresaId,
          clienteId,
          contratoId:              null,
          comprobanteConfigId:     comprobante.id,
          tipoComprobante:         comprobante.codigo,
          tipoComprobanteNombre:   comprobante.nombre,
          tieneCargaFiscal:        comprobante.tieneCargaFiscal,
          serie, correlativo,
          periodoInicio, periodoFin,
          descripcion,
          subtotal: totalSubtotal, descuento: 0, igv: totalIgv, total: totalTotal,
          montoPagado: 0,
          items,
          estado:                  EstadoFactura.EMITIDA,
          fechaEmision:            new Date().toISOString().split('T')[0],
          fechaVencimiento,
          moneda:                  configGlobal.moneda,
          generadaAutomaticamente: true,
          createdBy:               user.sub,
        });

        const saved = await this.ds.transaction(async (manager) => {
          const f = await manager.save(factura);
          if (cargosPendientes.ids.length) {
            await manager.query(
              `UPDATE cargos_pendientes SET incluido_en_factura_id = $1, incluido_en = NOW() WHERE id = ANY($2)`,
              [f.id, cargosPendientes.ids],
            );
          }
          return f;
        });

        this.generarPdfAsync(saved, user.empresaId, {
          razonSocial: primer.empresa_nombre, ruc: primer.empresa_ruc,
          direccionFiscal: primer.empresa_direccion,
        }, {
          nombreCompleto: primer.cliente_nombre, tipoDocumento: primer.tipo_documento,
          numeroDocumento: primer.cliente_documento, direccion: primer.cliente_direccion,
          email: primer.cliente_email, telefono: primer.cliente_telefono,
        });

        resultado.exitosas++;
        grupo.forEach(c => resultado.detalles.push({
          contratoId: c.contrato_id, numeroContrato: c.numero_contrato,
          resultado:  `generada: ${serie}-${correlativo} (${comprobante.nombre}) | total: ${configGlobal.moneda} ${totalTotal.toFixed(2)}`,
        }));

      } catch (err) {
        resultado.errores++;
        grupo.forEach(c => resultado.detalles.push({
          contratoId: c.contrato_id, numeroContrato: c.numero_contrato,
          resultado: 'error', error: err.message,
        }));
        this.logger.error(`Error generando factura cliente ${primer.cliente_id}: ${err.message}`);
      }
    }

    await this.auditoria.log({
      empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      accion: 'GENERATE_MONTHLY', modulo: 'facturacion',
      descripcion: `Generación mensual ${mes}/${anio}: ${resultado.exitosas} exitosas, ${resultado.omitidas} omitidas, ${resultado.errores} errores`,
      req,
    });

    return resultado;
  }

  // ────────────────────────────────────────────────────────────
  // GENERACIÓN AUTOMÁTICA DIARIA (desde CobranzaScheduler)
  // ────────────────────────────────────────────────────────────
  async generarFacturasDelDia(
    empresaId: string, dia: number, mes: number, anio: number,
  ): Promise<ResultadoGeneracion> {
    const contratos = await this.facturaRepo.findContratosParaFacturar(
      empresaId, mes, anio, undefined, dia,
    );
    if (!contratos.length) {
      return { total: 0, exitosas: 0, omitidas: 0, errores: 0, detalles: [] };
    }

    const configGlobal = await this.comprobantesSvc.getConfiguracion(empresaId);

    const porCliente = new Map<string, typeof contratos>();
    for (const c of contratos) {
      if (!porCliente.has(c.cliente_id)) porCliente.set(c.cliente_id, []);
      porCliente.get(c.cliente_id)!.push(c);
    }

    const resultado: ResultadoGeneracion = {
      total: porCliente.size, exitosas: 0, omitidas: 0, errores: 0, detalles: [],
    };
    const periodoInicio = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const periodoFin    = this.ultimoDiaMes(anio, mes);

    for (const [clienteId, grupo] of porCliente) {
      const primer = grupo[0];
      try {
        if (await this.facturaRepo.existeFacturaClientePeriodo(clienteId, periodoInicio, periodoFin)) {
          resultado.omitidas++;
          grupo.forEach(c => resultado.detalles.push({
            contratoId: c.contrato_id, numeroContrato: c.numero_contrato,
            resultado: 'omitida — ya facturado',
          }));
          continue;
        }

        const comprobante = await this.comprobantesSvc.resolverParaCliente(empresaId, clienteId);
        const igvRate     = Number(configGlobal.igvRate);
        const diasGracia  = parseInt(primer.dias_gracia || '5', 10);

        let totalSubtotal = 0, totalIgv = 0, totalTotal = 0;
        const items: ItemFactura[] = [];

        for (const contrato of grupo) {
          const precioBase = parseFloat(contrato.precio || '0');
          const contratoAplicaIgv = comprobante.tieneCargaFiscal &&
            (contrato.aplica_igv === true || contrato.aplica_igv === 'true');

          const { subtotal: sub, igv: igvItem, total: tot } =
            this.calcularMontosDesdeBase(precioBase, 0, contratoAplicaIgv, igvRate);

          items.push({
            descripcion: `${contrato.plan_nombre} — ${this.mesNombre(mes)} ${anio}`,
            cantidad: 1, precioUnitario: sub, descuento: 0, subtotal: sub, tipoItem: 'servicio',
          });
          totalSubtotal += sub; totalIgv += igvItem; totalTotal += tot;
        }

        const cargosPendientes = await this.consumirCargosPendientes(clienteId, empresaId, igvRate);
        for (const cargo of cargosPendientes.items) {
          items.push(cargo);
          totalSubtotal += cargo.subtotal;
          totalIgv      += cargo.igvItem ?? 0;
          totalTotal    += cargo.total;
        }

        totalSubtotal = Math.round(totalSubtotal * 100) / 100;
        totalIgv      = Math.round(totalIgv      * 100) / 100;
        totalTotal    = Math.round(totalTotal     * 100) / 100;

        const { correlativo } = await this.comprobantesSvc.siguienteCorrelativo(comprobante.id);
        const serie = comprobante.serie;
        const vencimientoDate  = new Date(anio, mes - 1, dia + diasGracia);
        const fechaVencimiento = vencimientoDate.toISOString().split('T')[0];
        const descripcion = grupo.length === 1
          ? `${comprobante.nombre} — ${primer.plan_nombre} · ${this.mesNombre(mes)} ${anio}`
          : `${comprobante.nombre} — Servicios contratados · ${this.mesNombre(mes)} ${anio}`;

        const factura = this.facturaRepo.create({
          empresaId, clienteId, contratoId: null,
          comprobanteConfigId: comprobante.id, tipoComprobante: comprobante.codigo,
          tipoComprobanteNombre: comprobante.nombre, tieneCargaFiscal: comprobante.tieneCargaFiscal,
          serie, correlativo, periodoInicio, periodoFin, descripcion,
          subtotal: totalSubtotal, descuento: 0, igv: totalIgv, total: totalTotal, montoPagado: 0,
          items, estado: EstadoFactura.EMITIDA,
          fechaEmision: new Date().toISOString().split('T')[0],
          fechaVencimiento, moneda: configGlobal.moneda, generadaAutomaticamente: true,
        });

        const saved = await this.ds.transaction(async (manager) => {
          const f = await manager.save(factura);
          if (cargosPendientes.ids.length) {
            await manager.query(
              `UPDATE cargos_pendientes SET incluido_en_factura_id = $1, incluido_en = NOW() WHERE id = ANY($2)`,
              [f.id, cargosPendientes.ids],
            );
          }
          return f;
        });

        this.generarPdfAsync(saved, empresaId, {
          razonSocial: primer.empresa_nombre, ruc: primer.empresa_ruc,
          direccionFiscal: primer.empresa_direccion,
        }, {
          nombreCompleto: primer.cliente_nombre, tipoDocumento: primer.tipo_documento,
          numeroDocumento: primer.cliente_documento, direccion: primer.cliente_direccion,
          email: primer.cliente_email, telefono: primer.cliente_telefono,
        });

        resultado.exitosas++;
        grupo.forEach(c => resultado.detalles.push({
          contratoId: c.contrato_id, numeroContrato: c.numero_contrato,
          resultado: `generada: ${serie}-${correlativo} (${comprobante.nombre}) | ${configGlobal.moneda} ${totalTotal.toFixed(2)}`,
        }));

      } catch (err) {
        resultado.errores++;
        grupo.forEach(c => resultado.detalles.push({
          contratoId: c.contrato_id, numeroContrato: c.numero_contrato,
          resultado: 'error', error: err.message,
        }));
        this.logger.error(`[AUTO] Error cliente ${primer.cliente_id}: ${err.message}`);
      }
    }

    await this.auditoria.log({
      empresaId, accion: 'AUTO_GENERATE_DAILY', modulo: 'facturacion',
      descripcion: `Auto-generación día ${dia}/${mes}/${anio}: ${resultado.exitosas} exitosas, ${resultado.omitidas} omitidas, ${resultado.errores} errores`,
    });

    return resultado;
  }

  // ────────────────────────────────────────────────────────────
  // REGISTRAR CARGO PENDIENTE (mora o reconexión)
  // El CobranzaWorker llama esto cuando ocurre un evento de
  // suspensión/reactivación y la config dice "acumular".
  // ────────────────────────────────────────────────────────────
  async registrarCargoPendiente(params: {
    empresaId: string;
    clienteId: string;
    contratoId: string | null;
    tipo: 'mora' | 'reconexion';
    monto: number;
    descripcion?: string;
    generadoPor?: string;
  }): Promise<CargoPendiente> {
    const configGlobal = await this.comprobantesSvc.getConfiguracion(params.empresaId);

    // Verificar que la config dice acumular para este tipo
    if (params.tipo === 'mora' && !configGlobal.moraAcumulaSiguienteCiclo) {
      throw new BadRequestException('La mora está configurada para no acumularse');
    }
    if (params.tipo === 'reconexion' && !configGlobal.reconexionAcumulaSiguienteCiclo) {
      throw new BadRequestException('La reconexión está configurada para no acumularse');
    }

    const repo = this.ds.getRepository(CargoPendiente);
    const cargo = repo.create({
      empresaId:   params.empresaId,
      clienteId:   params.clienteId,
      contratoId:  params.contratoId,
      tipo:        params.tipo,
      monto:       params.monto,
      // mora = NUNCA IGV | reconexion = SIEMPRE IGV
      aplicaIgv:   params.tipo === 'reconexion',
      descripcion: params.descripcion ?? null,
      incluidoEnFacturaId: null,
      incluidoEn:  null,
      generadoPor: params.generadoPor ?? null,
    });

    return repo.save(cargo);
  }

  // ────────────────────────────────────────────────────────────
  // MARCAR VENCIDAS — batch UPDATE en lugar de N+1 queries
  // ────────────────────────────────────────────────────────────
  async marcarVencidas(): Promise<number> {
    const { affected } = await this.ds.createQueryBuilder()
      .update(Factura)
      .set({ estado: EstadoFactura.VENCIDA })
      .where("estado IN ('emitida', 'pagada_parcial')")
      .andWhere('fecha_vencimiento < CURRENT_DATE')
      .andWhere('deleted_at IS NULL')
      .execute();

    if (affected) this.logger.log(`Facturas marcadas como vencidas: ${affected}`);
    return affected ?? 0;
  }

  // ────────────────────────────────────────────────────────────
  // APLICAR PAGO
  // ────────────────────────────────────────────────────────────
  async aplicarPago(
    facturaId: string, montoPago: number, empresaId: string, fechaPago: string,
  ): Promise<Factura> {
    // UPDATE atómico: elimina la race condition de leer-calcular-escribir.
    // La condición del WHERE valida estado y que el monto no exceda el saldo
    // pendiente (tolerancia de 1 centavo para redondeos de punto flotante).
    const result = await this.ds.query<{ id: string; estado: string }[]>(`
      UPDATE facturas
      SET
        monto_pagado = monto_pagado::numeric + $3::numeric,
        estado = CASE
          WHEN monto_pagado::numeric + $3::numeric >= total::numeric THEN 'pagada'
          ELSE 'pagada_parcial'
        END,
        fecha_pago = CASE
          WHEN monto_pagado::numeric + $3::numeric >= total::numeric THEN $4
          ELSE fecha_pago
        END
      WHERE id = $1 AND empresa_id = $2 AND deleted_at IS NULL
        AND estado NOT IN ('pagada', 'anulada')
        AND $3::numeric <= (total::numeric - monto_pagado::numeric + 0.01)
      RETURNING id, estado
    `, [facturaId, empresaId, montoPago, fechaPago]);

    if (!result.length) {
      const factura = await this.findOne(facturaId, empresaId);
      if (factura.estado === EstadoFactura.ANULADA)
        throw new BadRequestException('No se puede aplicar un pago a una factura anulada');
      if (factura.estado === EstadoFactura.PAGADA)
        throw new BadRequestException('La factura ya está completamente pagada');
      const saldo = Number(factura.total) - Number(factura.montoPagado);
      throw new BadRequestException(
        `El monto S/ ${montoPago.toFixed(2)} excede el saldo pendiente S/ ${saldo.toFixed(2)}`,
      );
    }

    const actualizada = await this.findOne(facturaId, empresaId);
    if (result[0].estado === EstadoFactura.PAGADA) {
      this.generarPdfAsync(actualizada, empresaId);
    }
    return actualizada;
  }

  // ────────────────────────────────────────────────────────────
  // ANULAR
  // ────────────────────────────────────────────────────────────
  async anular(
    id: string, dto: AnularFacturaDto, user: JwtPayload, req?: any,
  ): Promise<{ factura: Factura; notaCredito?: Factura }> {
    const factura = await this.findOne(id, user.empresaId);

    if (factura.estado === EstadoFactura.ANULADA)
      throw new BadRequestException('La factura ya está anulada');
    if (factura.estado === EstadoFactura.PAGADA)
      throw new BadRequestException('No se puede anular una factura pagada. Emite una nota de crédito.');

    await this.facturaRepo.update(id, {
      estado: EstadoFactura.ANULADA, motivoAnulacion: dto.motivo,
      anuladaEn: new Date(), anuladaPor: user.sub,
    });

    const facturaAnulada = await this.findOne(id, user.empresaId);
    this.generarPdfAsync(facturaAnulada, user.empresaId);

    await this.auditoria.logUpdate({
      empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      modulo: 'facturacion', entidadId: id,
      descripcion: `${facturaAnulada.tipoComprobanteNombre} ${facturaAnulada.numeroCompleto} anulada: ${dto.motivo}`,
      req,
    });

    let notaCredito: Factura | undefined;
    if (dto.crearNotaCredito !== false) {
      notaCredito = await this.crearNotaCredito({ facturaOriginalId: id, motivo: dto.motivo }, user, req);
    }

    return { factura: facturaAnulada, notaCredito };
  }

  // ────────────────────────────────────────────────────────────
  // NOTA DE CRÉDITO
  // ────────────────────────────────────────────────────────────
  async crearNotaCredito(
    dto: CreateNotaCreditoDto, user: JwtPayload, req?: any,
  ): Promise<Factura> {
    const original = await this.findOne(dto.facturaOriginalId, user.empresaId);
    const configGlobal = await this.comprobantesSvc.getConfiguracion(user.empresaId);

    const montoAcreditar = dto.montoAcreditar ?? Number(original.total);
    const { subtotal, igv, total } = this.calcularMontosDesdeBase(
      montoAcreditar, 0, original.tieneCargaFiscal, Number(configGlobal.igvRate),
    );

    // Serie nota de crédito: 'NC-' + serie original
    const serieNc = `NC-${original.serie}`;
    // Advisory lock por empresa+serie para garantizar correlativos únicos
    // incluso bajo creación concurrente de notas de crédito.
    const [correlativoRow] = await this.ds.transaction(async manager => {
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        [`nc_correlativo_${user.empresaId}_${serieNc}`],
      );
      return manager.query<{ siguiente: string }[]>(`
        SELECT COALESCE(MAX(correlativo), 0) + 1 AS siguiente
        FROM facturas WHERE empresa_id = $1 AND serie = $2 AND deleted_at IS NULL
      `, [user.empresaId, serieNc]);
    });
    const correlativoNc = parseInt(correlativoRow.siguiente, 10);

    const nc = this.facturaRepo.create({
      empresaId:            user.empresaId,
      clienteId:            original.clienteId,
      contratoId:           original.contratoId,
      comprobanteConfigId:  original.comprobanteConfigId,
      tipoComprobante:      `nc_${original.tipoComprobante}`,
      tipoComprobanteNombre: `Nota de Crédito — ${original.tipoComprobanteNombre}`,
      tieneCargaFiscal:     original.tieneCargaFiscal,
      serie:                serieNc,
      correlativo:          correlativoNc,
      periodoInicio:        original.periodoInicio,
      periodoFin:           original.periodoFin,
      descripcion:          `Nota de crédito: ${dto.motivo} — Ref: ${original.numeroCompleto}`,
      subtotal, descuento: 0, igv, total, montoPagado: 0,
      items: [{
        descripcion:    `Anulación/rectificación de ${original.numeroCompleto}: ${dto.motivo}`,
        cantidad:       1, precioUnitario: subtotal, subtotal, tipoItem: 'servicio',
      }],
      estado:               EstadoFactura.EMITIDA,
      fechaEmision:         new Date().toISOString().split('T')[0],
      fechaVencimiento:     new Date().toISOString().split('T')[0],
      moneda:               original.moneda,
      facturaOriginalId:    original.id,
      generadaAutomaticamente: false,
      createdBy:            user.sub,
    });

    const saved = await this.facturaRepo.save(nc);
    this.generarPdfAsync(saved, user.empresaId);
    return saved;
  }

  // ────────────────────────────────────────────────────────────
  // CRUD / CONSULTAS
  // ────────────────────────────────────────────────────────────
  async findAll(empresaId: string, filters: FilterFacturaDto) {
    return formatPaginatedResponse(await this.facturaRepo.findAllPaginated(empresaId, filters));
  }

  async findOne(id: string, empresaId: string): Promise<Factura> {
    const f = await this.facturaRepo.findById(id, empresaId);
    if (!f) throw new NotFoundException(`Factura ${id} no encontrada`);
    return f;
  }

  async findByContrato(contratoId: string, empresaId: string) {
    return this.facturaRepo.findByContrato(contratoId, empresaId);
  }

  async findByCliente(clienteId: string, empresaId: string) {
    return this.facturaRepo.findByCliente(clienteId, empresaId);
  }

  async update(id: string, empresaId: string, dto: UpdateFacturaDto): Promise<Factura> {
    const factura = await this.findOne(id, empresaId);
    if (factura.estado === EstadoFactura.ANULADA)
      throw new BadRequestException('No se puede editar una factura anulada');

    if (dto.version !== undefined && factura.version !== dto.version) {
      throw new ConflictException({
        code: 'CONCURRENCY_CONFLICT',
        message: 'Los datos fueron modificados por otro usuario. Por favor, recargue la página.',
      });
    }

    const patch: Partial<Factura> = {};
    if (dto.contratoId       !== undefined) patch.contratoId      = dto.contratoId;
    if (dto.periodoInicio    !== undefined) patch.periodoInicio    = dto.periodoInicio;
    if (dto.periodoFin       !== undefined) patch.periodoFin       = dto.periodoFin;
    if (dto.descripcion      !== undefined) patch.descripcion      = dto.descripcion;
    if (dto.fechaVencimiento !== undefined) patch.fechaVencimiento = dto.fechaVencimiento;

    if (dto.comprobanteConfigId !== undefined) {
      const cfg = await this.ds.getRepository(ComprobanteConfig).findOne({
        where: { id: dto.comprobanteConfigId, empresaId, deletedAt: null as any },
      });
      if (!cfg) throw new NotFoundException('Tipo de comprobante no encontrado');
      patch.comprobanteConfigId   = cfg.id;
      patch.tipoComprobante       = cfg.codigo;
      patch.tipoComprobanteNombre = cfg.nombre;
      patch.tieneCargaFiscal      = cfg.tieneCargaFiscal;
    }

    if (dto.items !== undefined) {
      const configGlobal = await this.comprobantesSvc.getConfiguracion(empresaId);
      const igvRate      = Number(configGlobal.igvRate);
      const aplicaIgv    = factura.tieneCargaFiscal;

      const mappedItems: ItemFactura[] = dto.items.map(it => {
        const base = it.cantidad * it.precioUnitario;
        const desc = it.descuento ?? 0;
        return {
          descripcion: it.descripcion, cantidad: it.cantidad,
          precioUnitario: it.precioUnitario, descuento: desc,
          subtotal: +(base - base * (desc / 100)).toFixed(2),
          tipoItem: 'servicio',
        };
      });
      const subtotal = mappedItems.reduce((acc, it) => acc + it.subtotal, 0);
      const igv      = aplicaIgv ? subtotal * igvRate : 0;
      patch.items    = mappedItems;
      patch.subtotal = +subtotal.toFixed(2);
      patch.igv      = +igv.toFixed(2);
      patch.total    = +(subtotal + igv).toFixed(2);
    }

    await this.facturaRepo.update(id, patch);
    return this.findOne(id, empresaId);
  }

  async remove(id: string, empresaId: string): Promise<void> {
    const factura = await this.findOne(id, empresaId);
    if (factura.estado === EstadoFactura.PAGADA)
      throw new BadRequestException('No se puede eliminar una factura pagada');
    await this.facturaRepo.delete(id);
  }

  async regenerarPdf(id: string, empresaId: string): Promise<Factura> {
    const factura = await this.findOne(id, empresaId);
    await this.generarPdfAsync(factura, empresaId);
    return this.findOne(id, empresaId);
  }

  async getResumenFinanciero(empresaId: string): Promise<ResumenFinancieroDto> {
    const raw = await this.facturaRepo.getResumenFinanciero(empresaId);
    const facturadoMes = parseFloat(raw.facturado_mes || '0');
    const cobradoMes   = parseFloat(raw.cobrado_mes   || '0');
    return {
      facturadoMes, cobradoMes,
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

  async getPendientesPorContrato(contratoId: string) {
    return this.facturaRepo.findPendientesPorContrato(contratoId);
  }

  // ────────────────────────────────────────────────────────────
  // HELPERS PRIVADOS
  // ────────────────────────────────────────────────────────────

  private async getComprobanteById(id: string, empresaId: string): Promise<ComprobanteConfig> {
    const config = await this.ds.getRepository(ComprobanteConfig).findOne({
      where: { id, empresaId, activo: true, deletedAt: null as any },
    });
    if (!config) throw new NotFoundException(`Tipo de comprobante ${id} no encontrado`);
    return config;
  }

  // Consume cargos pendientes (mora/reconexión) de un cliente
  // Retorna los items calculados + los IDs para marcar como incluidos post-save
  private async consumirCargosPendientes(
    clienteId: string,
    empresaId: string,
    igvRate: number,
  ): Promise<{ items: Array<ItemFactura & { igvItem: number; total: number }>; ids: string[] }> {
    const pendientes = await this.ds.getRepository(CargoPendiente).find({
      where: { clienteId, empresaId, incluidoEnFacturaId: null as any, deletedAt: null as any },
    });

    if (!pendientes.length) return { items: [], ids: [] };

    const items: Array<ItemFactura & { igvItem: number; total: number }> = [];
    const ids: string[] = [];

    for (const cargo of pendientes) {
      const { subtotal, igv: igvItem, total } = this.calcularMontosDesdeBase(
        cargo.monto, 0, cargo.aplicaIgv, igvRate,
      );
      items.push({
        descripcion:    cargo.descripcion ?? (cargo.tipo === 'mora' ? 'Cargo por mora' : 'Cargo por reconexión'),
        cantidad:       1,
        precioUnitario: subtotal,
        descuento:      0,
        subtotal,
        tipoItem:       cargo.tipo,
        aplicaIgvOverride: cargo.aplicaIgv,
        igvItem,
        total,
      });
      ids.push(cargo.id);
    }

    return { items, ids };
  }

  private async calcularMontos(
    dto: CreateFacturaDto,
    comprobante: ComprobanteConfig,
    igvRate: number,
  ): Promise<{ subtotal: number; descuento: number; igv: number; total: number; items: ItemFactura[] }> {
    const aplicaIgv = comprobante.tieneCargaFiscal && (dto.aplicaIgv !== false);
    let subtotal = 0;
    let items: ItemFactura[] = [];

    if (dto.items?.length) {
      items = dto.items.map(item => {
        const sub = item.cantidad * item.precioUnitario - (item.descuento || 0);
        return { ...item, subtotal: Math.round(sub * 100) / 100, tipoItem: 'servicio' as const };
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

  private calcularMontosDesdeBase(
    subtotal: number, descuento: number, aplicaIgv: boolean, igvRate: number,
    items: ItemFactura[] = [],
  ): { subtotal: number; descuento: number; igv: number; total: number; items: ItemFactura[] } {
    const baseImponible = Math.max(0, subtotal - descuento);
    const rate = Number(igvRate) || 0.18;
    const igv   = aplicaIgv ? Math.round(baseImponible * rate * 100) / 100 : 0;
    const total = Math.round((baseImponible + igv) * 100) / 100;
    return {
      subtotal: Math.round(subtotal  * 100) / 100,
      descuento: Math.round(descuento * 100) / 100,
      igv, total, items,
    };
  }

  private calcularFechaVencimiento(diasGracia: number): string {
    const fecha = new Date();
    fecha.setDate(fecha.getDate() + diasGracia);
    return fecha.toISOString().split('T')[0];
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

  private generarPdfAsync(
    factura: Factura, empresaId: string,
    empresaOverride?: Partial<EmpresaPdfData>,
    clienteOverride?: Partial<ClientePdfData>,
  ): void {
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
    .then(pdfUrl => {
      if (pdfUrl) {
        return this.facturaRepo.update(factura.id, { pdfUrl, pdfGeneradoEn: new Date() });
      }
    })
    .catch(err => this.logger.error(`Error generando PDF para factura ${factura.id}: ${err.message}`));
  }
}
