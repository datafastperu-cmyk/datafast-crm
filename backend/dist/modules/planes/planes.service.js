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
var PlanesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlanesService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const plan_entity_1 = require("./entities/plan.entity");
let PlanesService = PlanesService_1 = class PlanesService {
    constructor(repo) {
        this.repo = repo;
        this.logger = new common_1.Logger(PlanesService_1.name);
    }
    async create(dto, user) {
        const existe = await this.repo.findOne({ where: { nombre: dto.nombre, empresaId: user.empresaId, deletedAt: null } });
        if (existe)
            throw new common_1.ConflictException(`Plan "${dto.nombre}" ya existe`);
        const plan = this.repo.create({ ...dto, empresaId: user.empresaId });
        return this.repo.save(plan);
    }
    async findAll(empresaId, filters) {
        const qb = this.repo.createQueryBuilder('p')
            .where('p.empresa_id = :empresaId', { empresaId }).andWhere('p.deleted_at IS NULL');
        if (filters.search)
            qb.andWhere('p.nombre ILIKE :s', { s: `%${filters.search}%` });
        if (filters.tipo)
            qb.andWhere('p.tipo = :tipo', { tipo: filters.tipo });
        if (filters.tipoServicio)
            qb.andWhere('p.tipo_servicio = :ts', { ts: filters.tipoServicio });
        if (filters.activo !== undefined)
            qb.andWhere('p.activo = :activo', { activo: filters.activo });
        qb.orderBy('p.orden_display', 'ASC').addOrderBy('p.precio', 'ASC');
        const [data, total] = await qb.getManyAndCount();
        return { data, total };
    }
    async findOne(id, empresaId) {
        const plan = await this.repo.findOne({ where: { id, empresaId, deletedAt: null } });
        if (!plan)
            throw new common_1.NotFoundException(`Plan ${id} no encontrado`);
        return plan;
    }
    async update(id, dto, user) {
        await this.findOne(id, user.empresaId);
        await this.repo.update(id, dto);
        return this.findOne(id, user.empresaId);
    }
    async remove(id, user) {
        await this.findOne(id, user.empresaId);
        await this.repo.update(id, { deletedAt: new Date() });
    }
};
exports.PlanesService = PlanesService;
exports.PlanesService = PlanesService = PlanesService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(plan_entity_1.Plan)),
    __metadata("design:paramtypes", [typeorm_2.Repository])
], PlanesService);
//# sourceMappingURL=planes.service.js.map