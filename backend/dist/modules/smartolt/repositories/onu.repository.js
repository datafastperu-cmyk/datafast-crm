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
exports.OnuRepository = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("typeorm");
const typeorm_2 = require("@nestjs/typeorm");
const onu_entity_1 = require("../entities/onu.entity");
const pagination_util_1 = require("../../../common/utils/pagination.util");
let OnuRepository = class OnuRepository {
    constructor(ds) {
        this.ds = ds;
        this.onuRepo = ds.getRepository(onu_entity_1.Onu);
        this.oltRepo = ds.getRepository(onu_entity_1.Olt);
    }
    async saveOlt(data) {
        return this.oltRepo.save(this.oltRepo.create(data));
    }
    async findOltById(id, empresaId) {
        return this.oltRepo.findOne({ where: { id, empresaId, deletedAt: null } });
    }
    async findAllOlts(empresaId) {
        return this.oltRepo.find({
            where: { empresaId, activo: true, deletedAt: null },
            order: { nombre: 'ASC' },
        });
    }
    async updateOlt(id, data) {
        await this.oltRepo.update({ id }, data);
    }
    create(data) { return this.onuRepo.create(data); }
    async save(onu) { return this.onuRepo.save(onu); }
    async update(id, data) {
        await this.onuRepo.update({ id }, data);
    }
    async findById(id, empresaId) {
        return this.onuRepo.findOne({ where: { id, empresaId, deletedAt: null } });
    }
    async findBySerial(serial, empresaId) {
        return this.onuRepo.findOne({
            where: { serialNumber: serial.toUpperCase(), empresaId, deletedAt: null },
        });
    }
    async findByContratoId(contratoId) {
        const [row] = await this.ds.query(`
      SELECT o.* FROM onus o
      JOIN contratos c ON c.onu_id = o.id
      WHERE c.id = $1 AND o.deleted_at IS NULL
    `, [contratoId]);
        return row || null;
    }
    async findAllPaginated(empresaId, filters) {
        const qb = this.onuRepo.createQueryBuilder('o')
            .where('o.empresa_id = :empresaId', { empresaId })
            .andWhere('o.deleted_at IS NULL');
        if (filters.estado)
            qb.andWhere('o.estado = :estado', { estado: filters.estado });
        if (filters.oltId)
            qb.andWhere('o.olt_id = :oltId', { oltId: filters.oltId });
        if (filters.serialNumber)
            qb.andWhere('o.serial_number ILIKE :sn', { sn: `%${filters.serialNumber}%` });
        if (filters.ponPort)
            qb.andWhere('o.pon_port = :pp', { pp: filters.ponPort });
        if (filters.sinContrato)
            qb.andWhere(`o.id NOT IN (SELECT onu_id FROM contratos WHERE onu_id IS NOT NULL AND deleted_at IS NULL)`);
        if (filters.search) {
            qb.andWhere('(o.serial_number ILIKE :s OR o.descripcion ILIKE :s)', { s: `%${filters.search}%` });
        }
        return (0, pagination_util_1.paginate)(qb, filters, ['createdAt', 'serialNumber', 'estado', 'rxPowerDbm']);
    }
    async findByOlt(oltId, empresaId) {
        return this.onuRepo.find({
            where: { oltId, empresaId, deletedAt: null },
            order: { ponPort: 'ASC', onuId: 'ASC' },
        });
    }
    async findSinAprovisionar(empresaId, oltId) {
        const qb = this.onuRepo.createQueryBuilder('o')
            .where('o.empresa_id = :empresaId', { empresaId })
            .andWhere('o.estado = :estado', { estado: onu_entity_1.EstadoOnu.SIN_APROVISIONAR })
            .andWhere('o.deleted_at IS NULL');
        if (oltId)
            qb.andWhere('o.olt_id = :oltId', { oltId });
        return qb.orderBy('o.created_at', 'DESC').getMany();
    }
    async softDelete(id) {
        await this.onuRepo.update({ id }, { deletedAt: new Date() });
    }
    async getResumen(empresaId) {
        const rows = await this.onuRepo.createQueryBuilder('o')
            .select('o.estado', 'estado')
            .addSelect('COUNT(*)', 'total')
            .where('o.empresa_id = :empresaId', { empresaId })
            .andWhere('o.deleted_at IS NULL')
            .groupBy('o.estado')
            .getRawMany();
        return rows.reduce((acc, r) => {
            acc[r.estado] = parseInt(r.total, 10);
            return acc;
        }, {});
    }
    async findCompletaPorId(id, empresaId) {
        const [row] = await this.ds.query(`
      SELECT
        o.*,
        ol.nombre        AS olt_nombre,
        ol.modelo        AS olt_modelo,
        ol.ip_gestion    AS olt_ip,
        c.id             AS contrato_id,
        c.numero_contrato,
        c.usuario_pppoe,
        c.ip_asignada,
        cl.nombre_completo AS cliente_nombre,
        cl.telefono        AS cliente_telefono,
        pl.nombre          AS plan_nombre,
        pl.velocidad_bajada,
        pl.velocidad_subida
      FROM onus o
      LEFT JOIN olts      ol ON ol.id = o.olt_id
      LEFT JOIN contratos c  ON c.onu_id = o.id  AND c.deleted_at IS NULL
      LEFT JOIN clientes  cl ON cl.id = c.cliente_id
      LEFT JOIN planes    pl ON pl.id = c.plan_id
      WHERE o.id = $1 AND o.empresa_id = $2 AND o.deleted_at IS NULL
    `, [id, empresaId]);
        return row || null;
    }
};
exports.OnuRepository = OnuRepository;
exports.OnuRepository = OnuRepository = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_2.InjectDataSource)()),
    __metadata("design:paramtypes", [typeorm_1.DataSource])
], OnuRepository);
//# sourceMappingURL=onu.repository.js.map