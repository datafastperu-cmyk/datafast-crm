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
var ContratosService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContratosService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const crypto = require("crypto");
const contrato_repository_1 = require("./repositories/contrato.repository");
const planes_service_1 = require("../planes/planes.service");
const auditoria_service_1 = require("../auth/auditoria.service");
const contrato_entity_1 = require("./entities/contrato.entity");
const pagination_util_1 = require("../../common/utils/pagination.util");
const encryption_util_1 = require("../../common/utils/encryption.util");
const ip_util_1 = require("../../common/utils/ip.util");
const TRANSICIONES = {
    [contrato_entity_1.EstadoContrato.PENDIENTE_INSTALACION]: [contrato_entity_1.EstadoContrato.ACTIVO, contrato_entity_1.EstadoContrato.BAJA_DEFINITIVA],
    [contrato_entity_1.EstadoContrato.ACTIVO]: [contrato_entity_1.EstadoContrato.SUSPENDIDO_MORA, contrato_entity_1.EstadoContrato.SUSPENDIDO_MANUAL, contrato_entity_1.EstadoContrato.BAJA_SOLICITADA, contrato_entity_1.EstadoContrato.BAJA_DEFINITIVA, contrato_entity_1.EstadoContrato.MIGRADO],
    [contrato_entity_1.EstadoContrato.SUSPENDIDO_MORA]: [contrato_entity_1.EstadoContrato.ACTIVO, contrato_entity_1.EstadoContrato.PRORROGA, contrato_entity_1.EstadoContrato.BAJA_DEFINITIVA],
    [contrato_entity_1.EstadoContrato.SUSPENDIDO_MANUAL]: [contrato_entity_1.EstadoContrato.ACTIVO, contrato_entity_1.EstadoContrato.BAJA_DEFINITIVA],
    [contrato_entity_1.EstadoContrato.PRORROGA]: [contrato_entity_1.EstadoContrato.ACTIVO, contrato_entity_1.EstadoContrato.SUSPENDIDO_MORA, contrato_entity_1.EstadoContrato.BAJA_DEFINITIVA],
    [contrato_entity_1.EstadoContrato.BAJA_SOLICITADA]: [contrato_entity_1.EstadoContrato.ACTIVO, contrato_entity_1.EstadoContrato.BAJA_DEFINITIVA],
    [contrato_entity_1.EstadoContrato.BAJA_DEFINITIVA]: [],
    [contrato_entity_1.EstadoContrato.MIGRADO]: [],
};
let ContratosService = ContratosService_1 = class ContratosService {
    constructor(contratoRepo, planesSvc, auditoria, config) {
        this.contratoRepo = contratoRepo;
        this.planesSvc = planesSvc;
        this.auditoria = auditoria;
        this.config = config;
        this.logger = new common_1.Logger(ContratosService_1.name);
    }
    async create(dto, user, req) {
        const plan = await this.planesSvc.findOne(dto.planId, user.empresaId);
        if (!plan.activo)
            throw new common_1.BadRequestException(`Plan "${plan.nombre}" inactivo`);
        const contratosCliente = await this.contratoRepo.findByClienteId(dto.clienteId, user.empresaId);
        const duplicate = contratosCliente.find(c => c.planId === dto.planId &&
            [contrato_entity_1.EstadoContrato.ACTIVO, contrato_entity_1.EstadoContrato.PENDIENTE_INSTALACION, contrato_entity_1.EstadoContrato.PRORROGA].includes(c.estado));
        if (duplicate)
            throw new common_1.ConflictException(`Cliente ya tiene contrato activo con plan "${plan.nombre}" (${duplicate.numeroContrato})`);
        const numeroContrato = await this.contratoRepo.generarNumeroContrato(user.empresaId);
        let ipAsignada = null;
        if (dto.ipManual) {
            if (!(0, ip_util_1.isValidIp)(dto.ipManual))
                throw new common_1.BadRequestException(`IP inválida: ${dto.ipManual}`);
            if (dto.segmentoId) {
                const ocupada = await this.contratoRepo.ipYaAsignada(dto.ipManual, dto.segmentoId);
                if (ocupada)
                    throw new common_1.ConflictException(`IP ${dto.ipManual} ya asignada`);
            }
            ipAsignada = dto.ipManual;
        }
        else if (dto.segmentoId) {
            ipAsignada = await this.asignarIpDesdePool(dto.segmentoId, user.empresaId);
        }
        const usuarioPppoe = dto.usuarioPppoe || `cli_${dto.clienteId.replace(/-/g, '').substring(0, 8)}`;
        const passwordPlain = dto.passwordPppoePlain || this.generarPassword(12);
        let passwordCifrado;
        try {
            passwordCifrado = (0, encryption_util_1.encrypt)(passwordPlain);
        }
        catch {
            passwordCifrado = passwordPlain;
        }
        const contrato = this.contratoRepo.create({
            ...dto,
            empresaId: user.empresaId,
            numeroContrato,
            estado: contrato_entity_1.EstadoContrato.PENDIENTE_INSTALACION,
            fechaEstado: new Date(),
            usuarioPppoe,
            passwordPppoe: passwordCifrado,
            ipAsignada,
            precioMensual: dto.precioMensual ?? Number(plan.precio),
            diaFacturacion: dto.diaFacturacion ?? this.config.get('app.billing.day', 1),
            deudaTotal: 0, mesesDeuda: 0, aprovisionado: false,
            createdBy: user.sub, updatedBy: user.sub,
        });
        const saved = await this.contratoRepo.save(contrato);
        if (ipAsignada && dto.segmentoId) {
            await this.contratoRepo.asignarIp({ empresaId: user.empresaId, segmentoId: dto.segmentoId, contratoId: saved.id, ipAddress: ipAsignada, tipo: 'cliente', activa: true });
        }
        await this.contratoRepo.guardarHistorial({ contratoId: saved.id, empresaId: user.empresaId, estadoNuevo: contrato_entity_1.EstadoContrato.PENDIENTE_INSTALACION, motivo: `Plan: ${plan.nombre} | IP: ${ipAsignada || 'sin asignar'}`, usuarioId: user.sub });
        await this.auditoria.logCreate({ empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email, modulo: 'contratos', entidadId: saved.id, descripcion: `Contrato ${saved.numeroContrato}`, req });
        this.logger.log(`Contrato creado: ${saved.numeroContrato} | ip: ${ipAsignada}`);
        return saved;
    }
    async asignarIpDesdePool(segmentoId, empresaId) {
        const segmento = await this.contratoRepo.findSegmento(segmentoId, empresaId);
        if (!segmento)
            throw new common_1.NotFoundException(`Segmento ${segmentoId} no encontrado`);
        const [ipsUsadas, ipsReservadas] = await Promise.all([this.contratoRepo.getIpsUsadas(segmentoId), this.contratoRepo.getIpsReservadas(segmentoId)]);
        const ip = (0, ip_util_1.getNextAvailableIp)(segmento.redCidr, ipsUsadas, ipsReservadas);
        if (!ip) {
            const range = (0, ip_util_1.getCidrRange)(segmento.redCidr);
            throw new common_1.UnprocessableEntityException(`Pool "${segmento.nombre}" (${segmento.redCidr}) exhausto. Usadas: ${ipsUsadas.length}/${range.usableHosts}`);
        }
        return ip;
    }
    generarPassword(len) {
        const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#';
        return Array.from({ length: len }, () => chars[crypto.randomInt(0, chars.length)]).join('');
    }
    async findAll(empresaId, filters) {
        return (0, pagination_util_1.formatPaginatedResponse)(await this.contratoRepo.findAllPaginated(empresaId, filters));
    }
    async findOne(id, empresaId) {
        const c = await this.contratoRepo.findById(id, empresaId);
        if (!c)
            throw new common_1.NotFoundException(`Contrato ${id} no encontrado`);
        return c;
    }
    async findOneCompleto(id, empresaId) {
        const data = await this.contratoRepo.findCompleto(id, empresaId);
        if (!data)
            throw new common_1.NotFoundException(`Contrato ${id} no encontrado`);
        delete data.password_pppoe;
        return data;
    }
    async findByCliente(clienteId, empresaId) {
        return this.contratoRepo.findByClienteId(clienteId, empresaId);
    }
    async update(id, dto, user, req) {
        await this.findOne(id, user.empresaId);
        const upd = { ...dto, updatedBy: user.sub };
        delete upd.ipManual;
        delete upd.usuarioPppoe;
        delete upd.passwordPppoePlain;
        await this.contratoRepo.update(id, upd);
        return this.findOne(id, user.empresaId);
    }
    async cambiarEstado(id, dto, user, automatico = false, req) {
        const contrato = await this.findOne(id, user.empresaId);
        const anterior = contrato.estado;
        if (!automatico) {
            const permitidos = TRANSICIONES[contrato.estado] ?? [];
            if (!permitidos.includes(dto.estado))
                throw new common_1.BadRequestException(`Transición ${anterior} → ${dto.estado} no permitida. Válidas: ${permitidos.join(', ') || 'ninguna'}`);
        }
        const upd = { estado: dto.estado, fechaEstado: new Date(), motivoEstado: dto.motivo, updatedBy: user.sub };
        if (dto.estado === contrato_entity_1.EstadoContrato.BAJA_DEFINITIVA) {
            upd.fechaBaja = new Date().toISOString().split('T')[0];
            upd.motivoBaja = dto.motivo;
            if (contrato.segmentoId)
                await this.contratoRepo.liberarIp(id);
        }
        await this.contratoRepo.update(id, upd);
        await this.contratoRepo.guardarHistorial({ contratoId: id, empresaId: user.empresaId, estadoAnterior: anterior, estadoNuevo: dto.estado, motivo: dto.motivo, usuarioId: user.sub, automatico });
        await this.auditoria.logUpdate({ empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email, modulo: 'contratos', entidadId: id, descripcion: `Estado: ${anterior} → ${dto.estado}`, req });
        return this.findOne(id, user.empresaId);
    }
    async otorgarProrroga(id, dto, user, req) {
        const c = await this.findOne(id, user.empresaId);
        if (![contrato_entity_1.EstadoContrato.ACTIVO, contrato_entity_1.EstadoContrato.SUSPENDIDO_MORA, contrato_entity_1.EstadoContrato.PRORROGA].includes(c.estado))
            throw new common_1.BadRequestException(`No se puede prorrogar contrato en estado ${c.estado}`);
        if (new Date(dto.prorrogaHasta) <= new Date())
            throw new common_1.BadRequestException('Fecha de prórroga debe ser futura');
        await this.contratoRepo.update(id, { enProrroga: true, prorrogaHasta: dto.prorrogaHasta, prorrogaMotivo: dto.motivo, prorrogaOtorgadaPor: user.sub, estado: contrato_entity_1.EstadoContrato.PRORROGA, updatedBy: user.sub });
        await this.contratoRepo.guardarHistorial({ contratoId: id, empresaId: user.empresaId, estadoAnterior: c.estado, estadoNuevo: contrato_entity_1.EstadoContrato.PRORROGA, motivo: `Prórroga hasta ${dto.prorrogaHasta}: ${dto.motivo}`, usuarioId: user.sub });
        return this.findOne(id, user.empresaId);
    }
    async activar(id, user, req) {
        const c = await this.findOne(id, user.empresaId);
        if (c.estado !== contrato_entity_1.EstadoContrato.PENDIENTE_INSTALACION)
            throw new common_1.BadRequestException(`Solo se activan contratos PENDIENTE_INSTALACION. Estado: ${c.estado}`);
        await this.contratoRepo.update(id, { estado: contrato_entity_1.EstadoContrato.ACTIVO, fechaEstado: new Date(), fechaInstalacion: new Date(), updatedBy: user.sub });
        await this.contratoRepo.guardarHistorial({ contratoId: id, empresaId: user.empresaId, estadoAnterior: contrato_entity_1.EstadoContrato.PENDIENTE_INSTALACION, estadoNuevo: contrato_entity_1.EstadoContrato.ACTIVO, motivo: 'Instalación completada', usuarioId: user.sub });
        return this.findOne(id, user.empresaId);
    }
    async actualizarDeuda(id, deudaTotal, mesesDeuda, empresaId) {
        await this.contratoRepo.update(id, { deudaTotal, mesesDeuda });
    }
    async registrarPago(id, fechaPago, empresaId) {
        await this.contratoRepo.update(id, { fechaUltimoPago: fechaPago });
    }
    async getHistorial(id, empresaId) {
        await this.findOne(id, empresaId);
        return this.contratoRepo.getHistorial(id);
    }
    async getResumen(empresaId) {
        const rows = await this.contratoRepo.getResumen(empresaId);
        return rows.reduce((acc, r) => { acc[r.estado] = { total: parseInt(r.total), deuda: parseFloat(r.deuda || '0') }; return acc; }, {});
    }
    async remove(id, user) {
        const c = await this.findOne(id, user.empresaId);
        if (c.estado !== contrato_entity_1.EstadoContrato.BAJA_DEFINITIVA)
            throw new common_1.BadRequestException('Solo se eliminan contratos en BAJA_DEFINITIVA');
        await this.contratoRepo.softDelete(id, user.empresaId);
    }
    async getMorososParaCorte(graceDays) { return this.contratoRepo.findMorososParaCorte(graceDays); }
    async getParaReactivar() { return this.contratoRepo.findParaReactivar(); }
    async getProrrogasVencidas() { return this.contratoRepo.findProrrogasVencidas(); }
};
exports.ContratosService = ContratosService;
exports.ContratosService = ContratosService = ContratosService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [contrato_repository_1.ContratoRepository,
        planes_service_1.PlanesService,
        auditoria_service_1.AuditoriaService,
        config_1.ConfigService])
], ContratosService);
//# sourceMappingURL=contratos.service.js.map