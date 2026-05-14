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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContratoRepository = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("typeorm");
const typeorm_2 = require("@nestjs/typeorm");
const contrato_entity_1 = require("../entities/contrato.entity");
const red_entity_1 = require("../entities/red.entity");
const pagination_util_1 = require("../../../common/utils/pagination.util");
let ContratoRepository = class ContratoRepository {
    constructor(ds) {
        this.ds = ds;
        this.repo = ds.getRepository(contrato_entity_1.Contrato);
        this.histRepo = ds.getRepository(contrato_entity_1.ContratoHistorial);
        this.segmentoRepo = ds.getRepository(red_entity_1.SegmentoIpv4);
        this.ipRepo = ds.getRepository(red_entity_1.IpAsignada);
    }
    create(d) { return this.repo.create(d); }
    async save(c) { return this.repo.save(c); }
    async update(id, d) { await this.repo.update({ id }, d); }
    async findById(id, empresaId) {
        return this.repo.findOne({ where: { id, empresaId, deletedAt: null } });
    }
    async findByClienteId(clienteId, empresaId) {
        return this.repo.find({ where: { clienteId, empresaId, deletedAt: null }, order: { createdAt: 'DESC' } });
    }
    async softDelete(id, empresaId) {
        await this.repo.update({ id, empresaId }, { deletedAt: new Date() });
    }
    async findAllPaginated(empresaId, filters) {
        return (0, pagination_util_1.paginate)(this.buildFilterQuery(empresaId, filters), filters, ['createdAt', 'estado', 'fechaInicio', 'precioFinal', 'deudaTotal', 'numeroContrato']);
    }
    buildFilterQuery(empresaId, f) {
        const qb = this.repo.createQueryBuilder('c')
            .where('c.empresa_id = :empresaId', { empresaId })
            .andWhere('c.deleted_at IS NULL');
        if (f.search)
            qb.andWhere('(c.numero_contrato ILIKE :s OR c.usuario_pppoe ILIKE :s)', { s: `%${f.search}%` });
        if (f.estado)
            qb.andWhere('c.estado = :estado', { estado: f.estado });
        if (f.estados?.length)
            qb.andWhere('c.estado IN (:...estados)', { estados: f.estados });
        if (f.clienteId)
            qb.andWhere('c.cliente_id = :clienteId', { clienteId: f.clienteId });
        if (f.planId)
            qb.andWhere('c.plan_id = :planId', { planId: f.planId });
        if (f.routerId)
            qb.andWhere('c.router_id = :routerId', { routerId: f.routerId });
        if (f.conMora)
            qb.andWhere('c.deuda_total > 0');
        if (f.enProrroga)
            qb.andWhere('c.en_prorroga = true');
        if (f.aprovisionado !== undefined)
            qb.andWhere('c.aprovisionado = :ap', { ap: f.aprovisionado });
        if (f.fechaDesde)
            qb.andWhere('c.fecha_inicio >= :fd', { fd: f.fechaDesde });
        if (f.fechaHasta)
            qb.andWhere('c.fecha_inicio <= :fh', { fh: f.fechaHasta });
        return qb;
    }
    async findCompleto(id, empresaId) {
        const rows = await this.ds.query(`
      SELECT co.*,
        cl.nombre_completo AS cliente_nombre, cl.telefono AS cliente_telefono, cl.email AS cliente_email,
        pl.nombre AS plan_nombre, pl.velocidad_bajada, pl.velocidad_subida, pl.tipo_queue, pl.ppp_profile,
        ro.nombre AS router_nombre, ro.ip_gestion AS router_ip, ro.estado AS router_estado,
        on2.serial_number AS onu_serial, on2.estado AS onu_estado, on2.rx_power_dbm AS onu_rx_power
      FROM contratos co
      JOIN clientes cl ON cl.id = co.cliente_id
      JOIN planes   pl ON pl.id = co.plan_id
      LEFT JOIN routers ro  ON ro.id = co.router_id
      LEFT JOIN onus   on2  ON on2.id = co.onu_id
      WHERE co.id = $1 AND co.empresa_id = $2 AND co.deleted_at IS NULL
    `, [id, empresaId]);
        return rows[0] || null;
    }
    async findSegmento(id, empresaId) {
        return this.segmentoRepo.findOne({ where: { id, empresaId, activo: true, deletedAt: null } });
    }
    async getIpsUsadas(segmentoId) {
        const rows = await this.ipRepo.find({ where: { segmentoId, activa: true }, select: ['ipAddress'] });
        return rows.map(r => r.ipAddress);
    }
    async getIpsReservadas(segmentoId) {
        const seg = await this.segmentoRepo.findOne({ where: { id: segmentoId } });
        const res = [];
        if (seg?.gateway)
            res.push(seg.gateway);
        if (seg?.ipsReservadas?.length)
            res.push(...seg.ipsReservadas);
        return res;
    }
    async asignarIp(d) {
        return this.ipRepo.save(this.ipRepo.create(d));
    }
    async liberarIp(contratoId) {
        await this.ipRepo.update({ contratoId, activa: true }, { activa: false, liberadaEn: new Date() });
    }
    async ipYaAsignada(ip, segmentoId) {
        return (await this.ipRepo.count({ where: { ipAddress: ip, segmentoId, activa: true } })) > 0;
    }
    async generarNumeroContrato(empresaId) {
        const year = new Date().getFullYear();
        const count = await this.repo.createQueryBuilder('c')
            .where('c.empresa_id = :empresaId', { empresaId })
            .andWhere('EXTRACT(YEAR FROM c.created_at) = :year', { year })
            .getCount();
        return `CNT-${year}-${String(count + 1).padStart(6, '0')}`;
    }
    async guardarHistorial(d) {
        await this.histRepo.save(this.histRepo.create(d));
    }
    async getHistorial(contratoId) {
        return this.histRepo.find({ where: { contratoId }, order: { createdAt: 'DESC' }, take: 50 });
    }
    async findMorososParaCorte(graceDays) {
        const limitDate = new Date();
        limitDate.setDate(limitDate.getDate() - graceDays);
        return this.repo.createQueryBuilder('c')
            .where('c.estado IN (:...estados)', { estados: [contrato_entity_1.EstadoContrato.ACTIVO, contrato_entity_1.EstadoContrato.PRORROGA] })
            .andWhere('c.deuda_total > 0').andWhere('c.deleted_at IS NULL')
            .andWhere('(c.en_prorroga = false OR (c.en_prorroga = true AND c.prorroga_hasta < :hoy))', { hoy: new Date().toISOString().split('T')[0] })
            .andWhere('c.fecha_estado <= :limite', { limite: limitDate }).getMany();
    }
    async findParaReactivar() {
        return this.repo.createQueryBuilder('c')
            .where('c.estado = :estado', { estado: contrato_entity_1.EstadoContrato.SUSPENDIDO_MORA })
            .andWhere('c.deuda_total <= 0').andWhere('c.deleted_at IS NULL').getMany();
    }
    async findProrrogasVencidas() {
        const hoy = new Date().toISOString().split('T')[0];
        return this.repo.createQueryBuilder('c')
            .where('c.en_prorroga = true').andWhere('c.prorroga_hasta < :hoy', { hoy })
            .andWhere('c.deleted_at IS NULL').getMany();
    }
    async getResumen(empresaId) {
        return this.repo.createQueryBuilder('c')
            .select('c.estado', 'estado').addSelect('COUNT(*)', 'total').addSelect('SUM(c.deuda_total)', 'deuda')
            .where('c.empresa_id = :empresaId', { empresaId }).andWhere('c.deleted_at IS NULL')
            .groupBy('c.estado').getRawMany();
    }
};
exports.ContratoRepository = ContratoRepository;
exports.ContratoRepository = ContratoRepository = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_2.InjectDataSource)()),
    __metadata("design:paramtypes", [typeorm_1.DataSource])
], ContratoRepository);
//# sourceMappingURL=contrato.repository.js.map