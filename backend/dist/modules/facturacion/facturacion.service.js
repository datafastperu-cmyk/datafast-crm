"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var FacturacionService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.FacturacionService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const factura_repository_1 = require("./repositories/factura.repository");
const pdf_service_1 = require("./pdf.service");
const auditoria_service_1 = require("../auth/auditoria.service");
const factura_entity_1 = require("./entities/factura.entity");
const pagination_util_1 = require("../../common/utils/pagination.util");
let FacturacionService = FacturacionService_1 = class FacturacionService {
    constructor(facturaRepo, pdfSvc, auditoria, config, ds) {
        this.facturaRepo = facturaRepo;
        this.pdfSvc = pdfSvc;
        this.auditoria = auditoria;
        this.config = config;
        this.ds = ds;
        this.logger = new common_1.Logger(FacturacionService_1.name);
    }
    async create(dto, user, req) {
        const { subtotal, descuento, igv, total, items } = await this.calcularMontos(dto, user.empresaId);
        const { serie, correlativo } = await this.obtenerSerieCorrelativo(user.empresaId, dto.tipoComprobante || factura_entity_1.TipoComprobante.BOLETA);
        const fechaVencimiento = dto.fechaVencimiento || this.calcularFechaVencimiento(user.empresaId);
        const factura = this.facturaRepo.create({
            empresaId: user.empresaId,
            clienteId: dto.clienteId,
            contratoId: dto.contratoId,
            tipoComprobante: dto.tipoComprobante || factura_entity_1.TipoComprobante.BOLETA,
            serie,
            correlativo,
            periodoInicio: dto.periodoInicio,
            periodoFin: dto.periodoFin,
            descripcion: dto.descripcion || 'Servicio de internet',
            subtotal,
            descuento,
            igv,
            total,
            montoPagado: 0,
            items,
            estado: factura_entity_1.EstadoFactura.EMITIDA,
            fechaEmision: new Date().toISOString().split('T')[0],
            fechaVencimiento,
            moneda: dto.moneda || 'PEN',
            generadaAutomaticamente: false,
            createdBy: user.sub,
        });
        const saved = await this.facturaRepo.save(factura);
        this.generarPdfAsync(saved, user.empresaId);
        await this.auditoria.logCreate({
            empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
            modulo: 'facturacion', entidadId: saved.id,
            descripcion: `Factura ${serie}-${correlativo} · Cliente: ${dto.clienteId} · Total: ${total}`, req,
        });
        this.logger.log(`Factura creada: ${serie}-${correlativo} | total: ${total} | empresa: ${user.empresaId}`);
        return saved;
    }
    async generarMensual(dto, user, req) {
        const hoy = new Date();
        const mes = dto.mes ?? hoy.getMonth() + 1;
        const anio = dto.anio ?? hoy.getFullYear();
        this.logger.log(`Generación mensual: ${anio}/${mes} | empresa: ${user.empresaId} | usuario: ${user.email}`);
        const contratos = await this.facturaRepo.findContratosParaFacturar(user.empresaId, mes, anio, dto.contratoId);
        if (!contratos.length) {
            return { total: 0, exitosas: 0, omitidas: 0, errores: 0, detalles: [] };
        }
        const resultado = {
            total: contratos.length,
            exitosas: 0, omitidas: 0, errores: 0,
            detalles: [],
        };
        const tipoComprobante = dto.tipoComprobante || factura_entity_1.TipoComprobante.BOLETA;
        const igvRate = parseFloat(contratos[0]?.igv_rate || '0.18');
        const diasGracia = parseInt(contratos[0]?.dias_gracia || '5', 10);
        for (const contrato of contratos) {
            try {
                const periodoInicio = `${anio}-${String(mes).padStart(2, '0')}-01`;
                const periodoFin = this.ultimoDiaMes(anio, mes);
                const yaFacturado = await this.facturaRepo.existeFacturaPeriodo(contrato.contrato_id, periodoInicio, periodoFin);
                if (yaFacturado) {
                    resultado.omitidas++;
                    resultado.detalles.push({
                        contratoId: contrato.contrato_id,
                        numeroContrato: contrato.numero_contrato,
                        resultado: 'omitida — ya facturado este periodo',
                    });
                    continue;
                }
                const precioBase = parseFloat(contrato.precio || '0');
                const aplicaIgv = contrato.aplica_igv === true || contrato.aplica_igv === 'true';
                const { subtotal, descuento, igv, total } = this.calcularMontosDesdeBase(precioBase, 0, aplicaIgv, igvRate);
                const { serie, correlativo } = await this.obtenerSerieCorrelativo(user.empresaId, tipoComprobante);
                const diaVenc = parseInt(contrato.dia_facturacion || '1', 10) + diasGracia;
                const fechaVencimiento = `${anio}-${String(mes).padStart(2, '0')}-${String(Math.min(diaVenc, 28)).padStart(2, '0')}`;
                const factura = this.facturaRepo.create({
                    empresaId: user.empresaId,
                    clienteId: contrato.cliente_id,
                    contratoId: contrato.contrato_id,
                    tipoComprobante,
                    serie,
                    correlativo,
                    periodoInicio,
                    periodoFin,
                    descripcion: `Servicio de internet ${contrato.plan_nombre} — ${this.mesNombre(mes)} ${anio}`,
                    subtotal,
                    descuento: 0,
                    igv,
                    total,
                    montoPagado: 0,
                    items: this.buildItemsDesdeContrato(contrato, mes, anio),
                    estado: factura_entity_1.EstadoFactura.EMITIDA,
                    fechaEmision: new Date().toISOString().split('T')[0],
                    fechaVencimiento,
                    moneda: 'PEN',
                    generadaAutomaticamente: true,
                    createdBy: user.sub,
                });
                const saved = await this.facturaRepo.save(factura);
                this.generarPdfAsync(saved, user.empresaId, {
                    razonSocial: contrato.empresa_nombre,
                    ruc: contrato.empresa_ruc,
                    direccionFiscal: contrato.empresa_direccion,
                }, {
                    nombreCompleto: contrato.cliente_nombre,
                    tipoDocumento: contrato.tipo_documento,
                    numeroDocumento: contrato.cliente_documento,
                    direccion: contrato.cliente_direccion,
                    email: contrato.cliente_email,
                    telefono: contrato.cliente_telefono,
                });
                resultado.exitosas++;
                resultado.detalles.push({
                    contratoId: contrato.contrato_id,
                    numeroContrato: contrato.numero_contrato,
                    resultado: `generada: ${serie}-${correlativo} | total: S/ ${total.toFixed(2)}`,
                });
            }
            catch (err) {
                resultado.errores++;
                resultado.detalles.push({
                    contratoId: contrato.contrato_id,
                    numeroContrato: contrato.numero_contrato,
                    resultado: 'error',
                    error: err.message,
                });
                this.logger.error(`Error generando factura para contrato ${contrato.numero_contrato}: ${err.message}`);
            }
        }
        await this.auditoria.log({
            empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
            accion: 'GENERATE_MONTHLY', modulo: 'facturacion',
            descripcion: `Generación mensual ${mes}/${anio}: ${resultado.exitosas} exitosas, ${resultado.omitidas} omitidas, ${resultado.errores} errores`,
            req,
        });
        this.logger.log(`Generación ${mes}/${anio} completada: ${resultado.exitosas}/${resultado.total} facturas`);
        return resultado;
    }
    async anular(id, dto, user, req) {
        const factura = await this.findOne(id, user.empresaId);
        if (factura.estado === factura_entity_1.EstadoFactura.ANULADA) {
            throw new common_1.BadRequestException('La factura ya está anulada');
        }
        if (factura.estado === factura_entity_1.EstadoFactura.PAGADA) {
            throw new common_1.BadRequestException('No se puede anular una factura pagada. Emite una nota de crédito.');
        }
        await this.facturaRepo.update(id, {
            estado: factura_entity_1.EstadoFactura.ANULADA,
            motivoAnulacion: dto.motivo,
            anuladaEn: new Date(),
            anuladaPor: user.sub,
        });
        const facturaAnulada = await this.findOne(id, user.empresaId);
        this.generarPdfAsync(facturaAnulada, user.empresaId);
        await this.auditoria.logUpdate({
            empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
            modulo: 'facturacion', entidadId: id,
            descripcion: `Factura ${facturaAnulada.numeroCompleto} anulada: ${dto.motivo}`, req,
        });
        let notaCredito;
        if (dto.crearNotaCredito !== false) {
            notaCredito = await this.crearNotaCredito({ facturaOriginalId: id, motivo: dto.motivo }, user, req);
        }
        return { factura: facturaAnulada, notaCredito };
    }
    async crearNotaCredito(dto, user, req) {
        const original = await this.findOne(dto.facturaOriginalId, user.empresaId);
        if (original.tipoComprobante === factura_entity_1.TipoComprobante.NOTA_CREDITO) {
            throw new common_1.BadRequestException('No se puede emitir una nota de crédito de otra nota de crédito');
        }
        const montoAcreditar = dto.montoAcreditar ?? Number(original.total);
        const igvRate = this.getIgvRate();
        const aplicaIgv = Number(original.igv) > 0;
        const { subtotal, igv, total } = this.calcularMontosDesdeBase(montoAcreditar, 0, aplicaIgv, igvRate);
        const { serie, correlativo } = await this.obtenerSerieCorrelativo(user.empresaId, factura_entity_1.TipoComprobante.NOTA_CREDITO);
        const serieNc = original.tipoComprobante === factura_entity_1.TipoComprobante.FACTURA ? 'FC01' : 'BC01';
        const correlativoNc = await this.facturaRepo.siguienteCorrelativo(user.empresaId, serieNc);
        const nc = this.facturaRepo.create({
            empresaId: user.empresaId,
            clienteId: original.clienteId,
            contratoId: original.contratoId,
            tipoComprobante: factura_entity_1.TipoComprobante.NOTA_CREDITO,
            serie: serieNc,
            correlativo: correlativoNc,
            periodoInicio: original.periodoInicio,
            periodoFin: original.periodoFin,
            descripcion: `Nota de crédito por: ${dto.motivo} — Ref: ${original.numeroCompleto}`,
            subtotal,
            descuento: 0,
            igv,
            total,
            montoPagado: 0,
            items: [{
                    descripcion: `Anulación/rectificación de ${original.numeroCompleto}: ${dto.motivo}`,
                    cantidad: 1,
                    precioUnitario: subtotal,
                    subtotal,
                }],
            estado: factura_entity_1.EstadoFactura.EMITIDA,
            fechaEmision: new Date().toISOString().split('T')[0],
            fechaVencimiento: new Date().toISOString().split('T')[0],
            moneda: original.moneda,
            facturaOriginalId: original.id,
            generadaAutomaticamente: false,
            createdBy: user.sub,
        });
        const saved = await this.facturaRepo.save(nc);
        this.generarPdfAsync(saved, user.empresaId);
        this.logger.log(`Nota de crédito ${serieNc}-${correlativoNc} emitida ref: ${original.numeroCompleto}`);
        return saved;
    }
    async marcarVencidas() {
        const vencidas = await this.facturaRepo.findFacturasParaVencer();
        let count = 0;
        for (const f of vencidas) {
            await this.facturaRepo.update(f.id, { estado: factura_entity_1.EstadoFactura.VENCIDA });
            count++;
        }
        if (count > 0) {
            this.logger.log(`Facturas marcadas como vencidas: ${count}`);
        }
        return count;
    }
    async aplicarPago(facturaId, montoPago, empresaId, fechaPago) {
        const factura = await this.findOne(facturaId, empresaId);
        if (factura.estado === factura_entity_1.EstadoFactura.ANULADA) {
            throw new common_1.BadRequestException('No se puede aplicar un pago a una factura anulada');
        }
        if (factura.estado === factura_entity_1.EstadoFactura.PAGADA) {
            throw new common_1.BadRequestException('La factura ya está pagada');
        }
        const nuevoMontoPagado = Number(factura.montoPagado) + montoPago;
        const nuevoSaldo = Number(factura.total) - nuevoMontoPagado;
        const nuevoEstado = nuevoSaldo <= 0
            ? factura_entity_1.EstadoFactura.PAGADA
            : factura_entity_1.EstadoFactura.PAGADA_PARCIAL;
        await this.facturaRepo.update(facturaId, {
            montoPagado: nuevoMontoPagado,
            estado: nuevoEstado,
            fechaPago: nuevoSaldo <= 0 ? fechaPago : factura.fechaPago,
        });
        const actualizada = await this.findOne(facturaId, empresaId);
        if (nuevoEstado === factura_entity_1.EstadoFactura.PAGADA) {
            this.generarPdfAsync(actualizada, empresaId);
        }
        return actualizada;
    }
    async regenerarPdf(id, empresaId) {
        const factura = await this.findOne(id, empresaId);
        await this.generarPdfAsync(factura, empresaId);
        return this.findOne(id, empresaId);
    }
    async findAll(empresaId, filters) {
        const result = await this.facturaRepo.findAllPaginated(empresaId, filters);
        return (0, pagination_util_1.formatPaginatedResponse)(result);
    }
    async findOne(id, empresaId) {
        const f = await this.facturaRepo.findById(id, empresaId);
        if (!f)
            throw new common_1.NotFoundException(`Factura ${id} no encontrada`);
        return f;
    }
    async findByContrato(contratoId, empresaId) {
        return this.facturaRepo.findByContrato(contratoId, empresaId);
    }
    async findByCliente(clienteId, empresaId) {
        return this.facturaRepo.findByCliente(clienteId, empresaId);
    }
    async getResumenFinanciero(empresaId) {
        const raw = await this.facturaRepo.getResumenFinanciero(empresaId);
        const facturadoMes = parseFloat(raw.facturado_mes || '0');
        const cobradoMes = parseFloat(raw.cobrado_mes || '0');
        return {
            facturadoMes,
            cobradoMes,
            cobradoHoy: parseFloat(raw.cobrado_hoy || '0'),
            cobradoMesAnterior: parseFloat(raw.cobrado_mes_anterior || '0'),
            cuentasPorCobrar: parseFloat(raw.cuentas_por_cobrar || '0'),
            facturasVencidas: parseInt(raw.facturas_vencidas || '0', 10),
            totalEmitidas: parseInt(raw.total_emitidas || '0', 10),
            totalPagadas: parseInt(raw.total_pagadas || '0', 10),
            totalAnuladas: parseInt(raw.total_anuladas || '0', 10),
            tasaCobranza: facturadoMes > 0 ? Math.round((cobradoMes / facturadoMes) * 100) : 0,
        };
    }
    async getPendientesPorContrato(contratoId) {
        return this.facturaRepo.findPendientesPorContrato(contratoId);
    }
    async calcularMontos(dto, empresaId) {
        const igvRate = this.getIgvRate();
        const aplicaIgv = dto.aplicaIgv !== false;
        let subtotal = 0;
        let items = [];
        if (dto.items?.length) {
            items = dto.items.map((item) => {
                const sub = item.cantidad * item.precioUnitario - (item.descuento || 0);
                return { ...item, subtotal: Math.round(sub * 100) / 100 };
            });
            subtotal = items.reduce((acc, i) => acc + i.subtotal, 0);
        }
        else if (dto.subtotal !== undefined) {
            subtotal = dto.subtotal;
        }
        else {
            throw new common_1.BadRequestException('Debe proporcionar items o subtotal');
        }
        const descuento = dto.descuento || 0;
        return this.calcularMontosDesdeBase(subtotal, descuento, aplicaIgv, igvRate, items);
    }
    calcularMontosDesdeBase(subtotal, descuento, aplicaIgv, igvRate, items = []) {
        const baseImponible = Math.max(0, subtotal - descuento);
        let igv;
        let total;
        if (aplicaIgv) {
            igv = Math.round(baseImponible * igvRate * 100) / 100;
            total = Math.round((baseImponible + igv) * 100) / 100;
        }
        else {
            igv = 0;
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
    async obtenerSerieCorrelativo(empresaId, tipo) {
        const [empresa] = await this.ds.query('SELECT serie_boleta, serie_factura FROM empresas WHERE id = $1', [empresaId]);
        let serie;
        switch (tipo) {
            case factura_entity_1.TipoComprobante.FACTURA:
                serie = empresa?.serie_factura || 'F001';
                break;
            case factura_entity_1.TipoComprobante.NOTA_CREDITO:
                serie = 'BC01';
                break;
            case factura_entity_1.TipoComprobante.NOTA_DEBITO:
                serie = 'BD01';
                break;
            case factura_entity_1.TipoComprobante.RECIBO_INTERNO:
                serie = 'REC';
                break;
            default: serie = empresa?.serie_boleta || 'B001';
        }
        const correlativo = await this.facturaRepo.siguienteCorrelativo(empresaId, serie);
        return { serie, correlativo };
    }
    calcularFechaVencimiento(empresaId) {
        const diasGracia = this.config.get('app.billing.graceDays', 5);
        const fecha = new Date();
        fecha.setDate(fecha.getDate() + diasGracia);
        return fecha.toISOString().split('T')[0];
    }
    getIgvRate() {
        return this.config.get('app.billing.igvRate', 0.18);
    }
    ultimoDiaMes(anio, mes) {
        const ultimo = new Date(anio, mes, 0).getDate();
        return `${anio}-${String(mes).padStart(2, '0')}-${ultimo}`;
    }
    mesNombre(mes) {
        const nombres = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
            'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        return nombres[mes] || '';
    }
    buildItemsDesdeContrato(contrato, mes, anio) {
        return [{
                descripcion: `${contrato.plan_nombre} — ${this.mesNombre(mes)} ${anio}`,
                cantidad: 1,
                precioUnitario: parseFloat(contrato.precio || '0'),
                descuento: 0,
                subtotal: parseFloat(contrato.precio || '0'),
            }];
    }
    generarPdfAsync(factura, empresaId, empresaOverride, clienteOverride) {
        this.ds.query(`SELECT em.razon_social, em.ruc, em.direccion_fiscal, em.telefono, em.email,
              cl.nombre_completo, cl.tipo_documento, cl.numero_documento,
              cl.direccion, cl.email AS cl_email, cl.telefono AS cl_telefono,
              cl.es_empresa, cl.ruc_empresa, cl.razon_social AS cl_razon_social
       FROM facturas f
       JOIN empresas em ON em.id = f.empresa_id
       JOIN clientes cl ON cl.id = f.cliente_id
       WHERE f.id = $1`, [factura.id]).then(([row]) => {
            if (!row)
                return;
            const empresa = {
                razonSocial: empresaOverride?.razonSocial || row.razon_social,
                ruc: empresaOverride?.ruc || row.ruc,
                direccionFiscal: empresaOverride?.direccionFiscal || row.direccion_fiscal,
                telefono: row.telefono,
                email: row.email,
            };
            const cliente = {
                nombreCompleto: clienteOverride?.nombreCompleto || row.nombre_completo,
                tipoDocumento: clienteOverride?.tipoDocumento || row.tipo_documento,
                numeroDocumento: clienteOverride?.numeroDocumento || row.numero_documento,
                direccion: clienteOverride?.direccion || row.direccion,
                email: clienteOverride?.email || row.cl_email,
                telefono: clienteOverride?.telefono || row.cl_telefono,
                esEmpresa: row.es_empresa,
                rucEmpresa: row.ruc_empresa,
                razonSocial: row.cl_razon_social,
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
};
exports.FacturacionService = FacturacionService;
exports.FacturacionService = FacturacionService = FacturacionService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(4, (0, typeorm_1.InjectDataSource)()),
    __metadata("design:paramtypes", [factura_repository_1.FacturaRepository,
        pdf_service_1.PdfService,
        auditoria_service_1.AuditoriaService,
        config_1.ConfigService,
        typeorm_2.DataSource])
], FacturacionService);
//# sourceMappingURL=facturacion.service.js.map