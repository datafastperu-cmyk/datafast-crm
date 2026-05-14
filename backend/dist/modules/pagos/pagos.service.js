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
var PagosService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PagosService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const pago_repository_1 = require("./repositories/pago.repository");
const mercadopago_service_1 = require("./mercadopago.service");
const facturacion_service_1 = require("../facturacion/facturacion.service");
const contratos_service_1 = require("../contratos/contratos.service");
const auditoria_service_1 = require("../auth/auditoria.service");
const pago_entity_1 = require("./entities/pago.entity");
const contrato_entity_1 = require("../contratos/entities/contrato.entity");
const factura_entity_1 = require("../facturacion/entities/factura.entity");
const pagination_util_1 = require("../../common/utils/pagination.util");
const METODOS_AUTO_VERIFICAR = [
    pago_entity_1.MetodoPago.MERCADOPAGO,
];
const METODOS_REQUIEREN_NUMERO_OP = [
    pago_entity_1.MetodoPago.YAPE,
    pago_entity_1.MetodoPago.PLIN,
    pago_entity_1.MetodoPago.TRANSFERENCIA_BANCARIA,
    pago_entity_1.MetodoPago.DEPOSITO_BANCARIO,
];
let PagosService = PagosService_1 = class PagosService {
    constructor(pagoRepo, mpSvc, facturacionSvc, contratosSvc, auditoria, config, ds) {
        this.pagoRepo = pagoRepo;
        this.mpSvc = mpSvc;
        this.facturacionSvc = facturacionSvc;
        this.contratosSvc = contratosSvc;
        this.auditoria = auditoria;
        this.config = config;
        this.ds = ds;
        this.logger = new common_1.Logger(PagosService_1.name);
    }
    async registrar(dto, user, req) {
        await this.validarPago(dto, user.empresaId);
        if (dto.numeroOperacion) {
            const { existe, pagoExistente } = await this.pagoRepo.existeDuplicado(user.empresaId, dto.metodoPago, dto.numeroOperacion);
            if (existe) {
                throw new common_1.ConflictException(`Ya existe un pago registrado con el número de operación ${dto.numeroOperacion} ` +
                    `(${dto.metodoPago}). Pago existente ID: ${pagoExistente.id} · ` +
                    `Registrado: ${pagoExistente.registradoEn.toLocaleString('es-PE')}`);
            }
        }
        const autoVerificar = dto.autoVerificar ||
            METODOS_AUTO_VERIFICAR.includes(dto.metodoPago);
        const estadoInicial = autoVerificar
            ? pago_entity_1.EstadoPago.VERIFICADO
            : pago_entity_1.EstadoPago.PENDIENTE_VERIFICACION;
        const pago = this.pagoRepo.create({
            empresaId: user.empresaId,
            clienteId: dto.clienteId,
            facturaId: dto.facturaId,
            contratoId: dto.contratoId,
            monto: dto.monto,
            moneda: dto.moneda || 'PEN',
            metodoPago: dto.metodoPago,
            banco: dto.banco,
            numeroOperacion: dto.numeroOperacion,
            numeroCuenta: dto.numeroCuenta,
            fechaPago: dto.fechaPago || new Date().toISOString().split('T')[0],
            comprobanteUrl: dto.comprobanteUrl,
            notas: dto.notas,
            estado: estadoInicial,
            cajeroId: user.sub,
            verificadoPor: autoVerificar ? user.sub : null,
            verificadoEn: autoVerificar ? new Date() : null,
        });
        const saved = await this.pagoRepo.save(pago);
        this.logger.log(`Pago registrado: ${saved.id} | ${dto.metodoPago} | S/ ${dto.monto} | ` +
            `cliente: ${dto.clienteId} | estado: ${estadoInicial}`);
        if (autoVerificar) {
            await this.aplicarPagoAFacturaYContrato(saved, user);
        }
        await this.auditoria.logCreate({
            empresaId: user.empresaId,
            usuarioId: user.sub,
            usuarioEmail: user.email,
            modulo: 'pagos',
            entidadId: saved.id,
            descripcion: `Pago ${dto.metodoPago} S/ ${dto.monto} | cliente: ${dto.clienteId} | ${estadoInicial}`,
            req,
        });
        return saved;
    }
    async verificar(id, dto, user, req) {
        const pago = await this.findOne(id, user.empresaId);
        if (pago.estado !== pago_entity_1.EstadoPago.PENDIENTE_VERIFICACION) {
            throw new common_1.BadRequestException(`El pago ya fue ${pago.estado === pago_entity_1.EstadoPago.VERIFICADO ? 'verificado' : pago.estado}`);
        }
        if (dto.aprobado) {
            await this.pagoRepo.update(id, {
                estado: pago_entity_1.EstadoPago.VERIFICADO,
                verificadoPor: user.sub,
                verificadoEn: new Date(),
                extractoBancoRef: dto.extractoBancoRef,
            });
            const pagoVerificado = await this.findOne(id, user.empresaId);
            await this.aplicarPagoAFacturaYContrato(pagoVerificado, user);
            await this.auditoria.logUpdate({
                empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
                modulo: 'pagos', entidadId: id,
                descripcion: `Pago verificado/aprobado S/ ${pago.monto} | ${pago.metodoPago}`, req,
            });
            this.logger.log(`Pago aprobado: ${id} | S/ ${pago.monto} | por: ${user.email}`);
            return pagoVerificado;
        }
        else {
            if (!dto.motivoRechazo?.trim()) {
                throw new common_1.BadRequestException('Debes indicar el motivo del rechazo');
            }
            await this.pagoRepo.update(id, {
                estado: pago_entity_1.EstadoPago.RECHAZADO,
                motivoRechazo: dto.motivoRechazo,
                verificadoPor: user.sub,
                verificadoEn: new Date(),
            });
            this.logger.log(`Pago rechazado: ${id} | motivo: ${dto.motivoRechazo} | por: ${user.email}`);
            await this.auditoria.logUpdate({
                empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
                modulo: 'pagos', entidadId: id,
                descripcion: `Pago rechazado: ${dto.motivoRechazo}`, req,
            });
            return this.findOne(id, user.empresaId);
        }
    }
    async conciliar(id, dto, user, req) {
        const pago = await this.findOne(id, user.empresaId);
        if (pago.estado !== pago_entity_1.EstadoPago.VERIFICADO) {
            throw new common_1.BadRequestException('Solo se pueden conciliar pagos verificados');
        }
        if (pago.conciliado) {
            throw new common_1.BadRequestException('El pago ya está conciliado');
        }
        await this.pagoRepo.update(id, {
            conciliado: true,
            conciliadoEn: new Date(),
            conciliadoPor: user.sub,
            extractoBancoRef: dto.extractoBancoRef,
            notas: dto.notas ? `${pago.notas || ''}\n[Conciliación]: ${dto.notas}`.trim() : pago.notas,
        });
        return this.findOne(id, user.empresaId);
    }
    async procesarWebhookMercadoPago(body, rawBody, xSignature, xRequestId) {
        const firmaValida = this.mpSvc.validarWebhookSignature(rawBody, xSignature, xRequestId);
        if (!firmaValida) {
            this.logger.warn(`Webhook MP rechazado: firma inválida | requestId: ${xRequestId}`);
            throw new common_1.ForbiddenException('Firma de webhook inválida');
        }
        if (body.type !== 'payment') {
            this.logger.debug(`Webhook MP ignorado: tipo=${body.type}`);
            return;
        }
        const mpPaymentId = String(body.data?.id);
        if (!mpPaymentId) {
            this.logger.warn('Webhook MP sin payment ID');
            return;
        }
        this.logger.log(`Webhook MP recibido: payment ${mpPaymentId} | acción: ${body.action}`);
        const pagoExistente = await this.pagoRepo.findByMpPaymentId(mpPaymentId);
        if (pagoExistente?.estado === pago_entity_1.EstadoPago.VERIFICADO) {
            this.logger.debug(`Webhook MP: pago ${mpPaymentId} ya procesado`);
            return;
        }
        let mpPayment;
        try {
            mpPayment = await this.mpSvc.consultarPago(mpPaymentId);
        }
        catch (err) {
            this.logger.error(`Error consultando pago MP ${mpPaymentId}: ${err.message}`);
            return;
        }
        this.logger.log(`MP Payment ${mpPaymentId}: status=${mpPayment.status} | ` +
            `monto=${mpPayment.transaction_amount} | external_ref=${mpPayment.external_reference}`);
        const facturaId = mpPayment.external_reference;
        if (!facturaId) {
            this.logger.warn(`Webhook MP: sin external_reference en pago ${mpPaymentId}`);
            return;
        }
        const [facturaRow] = await this.ds.query('SELECT empresa_id, cliente_id, contrato_id, total, saldo FROM facturas WHERE id = $1', [facturaId]);
        if (!facturaRow) {
            this.logger.warn(`Webhook MP: factura ${facturaId} no encontrada`);
            return;
        }
        const { empresa_id: empresaId, cliente_id: clienteId, contrato_id: contratoId } = facturaRow;
        if (this.mpSvc.esAprobado(mpPayment)) {
            let pago;
            if (pagoExistente) {
                await this.pagoRepo.update(pagoExistente.id, {
                    mpStatus: mpPayment.status,
                    mpDetail: mpPayment,
                    estado: pago_entity_1.EstadoPago.VERIFICADO,
                    verificadoEn: new Date(),
                });
                pago = await this.pagoRepo.findById(pagoExistente.id, empresaId);
            }
            else {
                pago = await this.pagoRepo.save(this.pagoRepo.create({
                    empresaId,
                    clienteId,
                    facturaId,
                    contratoId,
                    monto: mpPayment.transaction_amount,
                    moneda: mpPayment.currency_id || 'PEN',
                    metodoPago: pago_entity_1.MetodoPago.MERCADOPAGO,
                    mpPaymentId: String(mpPayment.id),
                    mpStatus: mpPayment.status,
                    mpPreferenceId: mpPayment.preference_id,
                    mpDetail: mpPayment,
                    numeroOperacion: String(mpPayment.id),
                    fechaPago: new Date().toISOString().split('T')[0],
                    estado: pago_entity_1.EstadoPago.VERIFICADO,
                    verificadoEn: new Date(),
                    cajeroId: 'sistema-mp',
                    notas: `Pago automático via MercadoPago | ${mpPayment.payment_method_id}`,
                }));
            }
            const userSistema = {
                sub: 'sistema-mp', email: 'webhook@mercadopago.com',
                empresaId, roles: ['Administrador'], permisos: [], nombreCompleto: 'MercadoPago', tema: 'dark',
            };
            await this.aplicarPagoAFacturaYContrato(pago, userSistema);
            this.logger.log(`Pago MP aprobado aplicado: factura ${facturaId} | S/ ${pago.monto}`);
        }
        else if (this.mpSvc.esPendiente(mpPayment)) {
            this.logger.log(`Pago MP ${mpPaymentId} pendiente — esperando confirmación`);
        }
        else {
            if (pagoExistente) {
                await this.pagoRepo.update(pagoExistente.id, {
                    estado: pago_entity_1.EstadoPago.RECHAZADO,
                    mpStatus: mpPayment.status,
                    mpDetail: mpPayment,
                    motivoRechazo: `MercadoPago: ${mpPayment.status_detail}`,
                });
            }
            this.logger.log(`Pago MP ${mpPaymentId} rechazado: ${mpPayment.status_detail}`);
        }
    }
    async crearPreferenciaMp(dto, user) {
        const factura = await this.facturacionSvc.findOne(dto.facturaId, user.empresaId);
        if (factura.estado === factura_entity_1.EstadoFactura.PAGADA) {
            throw new common_1.BadRequestException('La factura ya está pagada');
        }
        if (factura.estado === factura_entity_1.EstadoFactura.ANULADA) {
            throw new common_1.BadRequestException('La factura está anulada');
        }
        const [cliente] = await this.ds.query('SELECT nombre_completo, email FROM clientes WHERE id = $1', [factura.clienteId]);
        return this.mpSvc.crearPreferencia({
            facturaId: factura.id,
            titulo: `${factura.numeroCompleto} — FibraNet ISP`,
            descripcion: factura.descripcion || 'Servicio de internet',
            monto: Number(factura.saldo || factura.total),
            clienteEmail: cliente?.email || `cliente-${factura.clienteId}@fibranet.pe`,
            urlExito: dto.urlExito,
            urlFallo: dto.urlFallo,
            urlPendiente: dto.urlPendiente,
        });
    }
    async aplicarPagoAFacturaYContrato(pago, user) {
        try {
            let facturaId = pago.facturaId;
            let contratoId = pago.contratoId;
            const empresaId = pago.empresaId;
            if (facturaId) {
                await this.facturacionSvc.aplicarPago(facturaId, Number(pago.monto), empresaId, pago.fechaPago);
                this.logger.log(`Pago ${pago.id} aplicado a factura ${facturaId}`);
                if (!contratoId) {
                    const [row] = await this.ds.query('SELECT contrato_id FROM facturas WHERE id = $1', [facturaId]);
                    contratoId = row?.contrato_id;
                }
            }
            if (contratoId) {
                await this.verificarYReactivarContrato(contratoId, empresaId, user);
            }
        }
        catch (err) {
            this.logger.error(`Error aplicando pago ${pago.id} a factura/contrato: ${err.message}`, err.stack);
        }
    }
    async verificarYReactivarContrato(contratoId, empresaId, user) {
        const { deuda, meses } = await this.pagoRepo.calcularDeudaContrato(contratoId);
        await this.contratosSvc.actualizarDeuda(contratoId, deuda, meses, empresaId);
        this.logger.debug(`Contrato ${contratoId}: deuda recalculada = S/ ${deuda} (${meses} meses)`);
        if (deuda <= 0) {
            let contrato;
            try {
                contrato = await this.contratosSvc.findOne(contratoId, empresaId);
            }
            catch {
                return;
            }
            const estadosSuspendidos = [
                contrato_entity_1.EstadoContrato.SUSPENDIDO_MORA,
                contrato_entity_1.EstadoContrato.PRORROGA,
            ];
            if (estadosSuspendidos.includes(contrato.estado)) {
                await this.contratosSvc.cambiarEstado(contratoId, {
                    estado: contrato_entity_1.EstadoContrato.ACTIVO,
                    motivo: `Reactivación automática — pago S/ ${contrato.deudaTotal} registrado`,
                }, user, true);
                this.logger.log(`🟢 Contrato REACTIVADO automáticamente: ${contratoId} | ` +
                    `deuda saldada: S/ ${contrato.deudaTotal}`);
            }
        }
    }
    async validarPago(dto, empresaId) {
        if (METODOS_REQUIEREN_NUMERO_OP.includes(dto.metodoPago) &&
            !dto.numeroOperacion?.trim()) {
            throw new common_1.BadRequestException(`El número de operación es obligatorio para pagos con ${dto.metodoPago}`);
        }
        if (dto.facturaId) {
            const [row] = await this.ds.query('SELECT id, estado, empresa_id FROM facturas WHERE id = $1', [dto.facturaId]);
            if (!row || row.empresa_id !== empresaId) {
                throw new common_1.NotFoundException('Factura no encontrada');
            }
            if (row.estado === factura_entity_1.EstadoFactura.PAGADA) {
                throw new common_1.BadRequestException('La factura ya está completamente pagada');
            }
            if (row.estado === factura_entity_1.EstadoFactura.ANULADA) {
                throw new common_1.BadRequestException('La factura está anulada');
            }
        }
        if (dto.contratoId && !dto.facturaId) {
            const [row] = await this.ds.query('SELECT id, empresa_id FROM contratos WHERE id = $1', [dto.contratoId]);
            if (!row || row.empresa_id !== empresaId) {
                throw new common_1.NotFoundException('Contrato no encontrado');
            }
        }
        if (Number(dto.monto) < 0.01) {
            throw new common_1.BadRequestException('El monto debe ser mayor a S/ 0.01');
        }
    }
    async findAll(empresaId, filters) {
        const result = await this.pagoRepo.findAllPaginated(empresaId, filters);
        return (0, pagination_util_1.formatPaginatedResponse)(result);
    }
    async findOne(id, empresaId) {
        const p = await this.pagoRepo.findById(id, empresaId);
        if (!p)
            throw new common_1.NotFoundException(`Pago ${id} no encontrado`);
        return p;
    }
    async findByCliente(clienteId, empresaId) {
        return this.pagoRepo.findByCliente(clienteId, empresaId);
    }
    async findByFactura(facturaId, empresaId) {
        return this.pagoRepo.findByFactura(facturaId, empresaId);
    }
    async findByContrato(contratoId, empresaId) {
        return this.pagoRepo.findByContrato(contratoId, empresaId);
    }
    async findPendientes(empresaId) {
        return this.pagoRepo.findPendientesVerificar(empresaId);
    }
    async getResumen(empresaId) {
        const [raw, ultimos] = await Promise.all([
            this.pagoRepo.getResumenCobranza(empresaId),
            this.pagoRepo.findUltimos(empresaId, 10),
        ]);
        const porMetodo = {};
        for (const r of (raw.porMetodo || [])) {
            porMetodo[r.metodo_pago] = {
                total: parseInt(r.total, 10),
                monto: parseFloat(r.monto || '0'),
            };
        }
        return {
            cobradoHoy: parseFloat(raw.cobrado_hoy || '0'),
            cobradoSemana: parseFloat(raw.cobrado_semana || '0'),
            cobradoMes: parseFloat(raw.cobrado_mes || '0'),
            cobradoMesAnterior: parseFloat(raw.cobrado_mes_anterior || '0'),
            pagosHoy: parseInt(raw.pagos_hoy || '0', 10),
            pagosSemana: parseInt(raw.pagos_semana || '0', 10),
            pagosMes: parseInt(raw.pagos_mes || '0', 10),
            pendientesVerificar: parseInt(raw.pendientes_verificar || '0', 10),
            porMetodo,
            ultimosPagos: ultimos,
        };
    }
    async getCuentasBancarias(empresaId) {
        return this.pagoRepo.findCuentas(empresaId);
    }
    async createCuentaBancaria(dto, user) {
        if (dto.esPrincipal) {
            await this.ds.query('UPDATE cuentas_bancarias SET es_principal = false WHERE empresa_id = $1', [user.empresaId]);
        }
        return this.pagoRepo.createCuenta({ ...dto, empresaId: user.empresaId });
    }
};
exports.PagosService = PagosService;
exports.PagosService = PagosService = PagosService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(6, (0, typeorm_1.InjectDataSource)()),
    __metadata("design:paramtypes", [pago_repository_1.PagoRepository,
        mercadopago_service_1.MercadoPagoService,
        facturacion_service_1.FacturacionService,
        contratos_service_1.ContratosService,
        auditoria_service_1.AuditoriaService,
        config_1.ConfigService,
        typeorm_2.DataSource])
], PagosService);
//# sourceMappingURL=pagos.service.js.map