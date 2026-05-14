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
exports.ClienteRepository = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("typeorm");
const typeorm_2 = require("@nestjs/typeorm");
const cliente_entity_1 = require("../entities/cliente.entity");
const pagination_util_1 = require("../../../common/utils/pagination.util");
let ClienteRepository = class ClienteRepository {
    constructor(ds) {
        this.ds = ds;
        this.repo = ds.getRepository(cliente_entity_1.Cliente);
        this.histRepo = ds.getRepository(cliente_entity_1.ClienteHistorialEstado);
    }
    create(data) { return this.repo.create(data); }
    async save(c) { return this.repo.save(c); }
    async findById(id, empresaId) {
        return this.repo.findOne({ where: { id, empresaId, deletedAt: null } });
    }
    async findByDocumento(tipo, numero, empresaId) {
        return this.repo.findOne({ where: { tipoDocumento: tipo, numeroDocumento: numero, empresaId, deletedAt: null } });
    }
    async findAllPaginated(empresaId, filters) {
        const qb = this.buildFilterQuery(empresaId, filters);
        return (0, pagination_util_1.paginate)(qb, filters, ['createdAt', 'nombreCompleto', 'estado', 'tipoServicio', 'fechaEstado', 'codigoCliente']);
    }
    buildFilterQuery(empresaId, filters) {
        const qb = this.repo.createQueryBuilder('c')
            .where('c.empresa_id = :empresaId', { empresaId })
            .andWhere('c.deleted_at IS NULL');
        if (filters.search?.trim()) {
            const term = `%${filters.search.trim()}%`;
            qb.andWhere(`(c.nombre_completo ILIKE :term OR c.numero_documento ILIKE :term
          OR c.email ILIKE :term OR c.telefono ILIKE :term
          OR c.codigo_cliente ILIKE :term OR c.direccion ILIKE :term)`, { term });
        }
        if (filters.estado)
            qb.andWhere('c.estado = :estado', { estado: filters.estado });
        if (filters.estados?.length)
            qb.andWhere('c.estado IN (:...estados)', { estados: filters.estados });
        if (filters.tipoServicio)
            qb.andWhere('c.tipo_servicio = :tipoServicio', { tipoServicio: filters.tipoServicio });
        if (filters.tipoDocumento)
            qb.andWhere('c.tipo_documento = :tipoDocumento', { tipoDocumento: filters.tipoDocumento });
        if (filters.documento)
            qb.andWhere('c.numero_documento = :documento', { documento: filters.documento });
        if (filters.telefono)
            qb.andWhere('(c.telefono ILIKE :tel OR c.telefono_alt ILIKE :tel)', { tel: `%${filters.telefono}%` });
        if (filters.distrito)
            qb.andWhere('c.distrito ILIKE :distrito', { distrito: `%${filters.distrito}%` });
        if (filters.vendedorId)
            qb.andWhere('c.vendedor_id = :vendedorId', { vendedorId: filters.vendedorId });
        if (filters.conUbicacion)
            qb.andWhere('c.latitud IS NOT NULL AND c.longitud IS NOT NULL');
        if (filters.esEmpresa !== undefined)
            qb.andWhere('c.es_empresa = :esEmpresa', { esEmpresa: filters.esEmpresa });
        if (filters.etiqueta)
            qb.andWhere(':etiqueta = ANY(c.etiquetas)', { etiqueta: filters.etiqueta });
        if (filters.fechaDesde)
            qb.andWhere('c.created_at >= :fechaDesde', { fechaDesde: new Date(filters.fechaDesde) });
        if (filters.fechaHasta) {
            const h = new Date(filters.fechaHasta);
            h.setHours(23, 59, 59, 999);
            qb.andWhere('c.created_at <= :fechaHasta', { fechaHasta: h });
        }
        return qb;
    }
    async getResumenEstados(empresaId) {
        const rows = await this.repo.createQueryBuilder('c')
            .select('c.estado', 'estado').addSelect('COUNT(*)', 'total')
            .where('c.empresa_id = :empresaId', { empresaId })
            .andWhere('c.deleted_at IS NULL')
            .groupBy('c.estado').getRawMany();
        return rows.reduce((acc, r) => { acc[r.estado] = parseInt(r.total, 10); return acc; }, {});
    }
    async findConUbicacion(empresaId) {
        return this.repo.createQueryBuilder('c')
            .select(['c.id', 'c.nombreCompleto', 'c.estado', 'c.latitud', 'c.longitud', 'c.tipoServicio', 'c.direccion', 'c.telefono'])
            .where('c.empresa_id = :empresaId', { empresaId })
            .andWhere('c.latitud IS NOT NULL').andWhere('c.deleted_at IS NULL')
            .getMany();
    }
    async softDelete(id, empresaId) {
        await this.repo.update({ id, empresaId }, { deletedAt: new Date() });
    }
    async update(id, data) {
        await this.repo.update({ id }, data);
    }
    async existeDocumento(tipo, numero, empresaId, excludeId) {
        const qb = this.repo.createQueryBuilder('c')
            .where('c.empresa_id = :empresaId', { empresaId })
            .andWhere('c.tipo_documento = :tipo', { tipo })
            .andWhere('c.numero_documento = :numero', { numero })
            .andWhere('c.deleted_at IS NULL');
        if (excludeId)
            qb.andWhere('c.id != :excludeId', { excludeId });
        return (await qb.getCount()) > 0;
    }
    async guardarHistorial(data) {
        await this.histRepo.save(this.histRepo.create(data));
    }
    async getHistorialEstados(clienteId) {
        return this.histRepo.find({ where: { clienteId }, order: { createdAt: 'DESC' }, take: 50 });
    }
    async getEstadisticas(empresaId) {
        const [totales, nuevosEsteMes] = await Promise.all([
            this.repo.createQueryBuilder('c')
                .select('c.estado', 'estado').addSelect('COUNT(*)', 'total')
                .where('c.empresa_id = :empresaId', { empresaId })
                .andWhere('c.deleted_at IS NULL')
                .groupBy('c.estado').getRawMany(),
            this.repo.createQueryBuilder('c')
                .where('c.empresa_id = :empresaId', { empresaId })
                .andWhere('c.deleted_at IS NULL')
                .andWhere("c.created_at >= DATE_TRUNC('month', NOW())")
                .getCount(),
        ]);
        return { totales, nuevosEsteMes };
    }
    async findAllForExport(empresaId, filters) {
        const qb = this.buildFilterQuery(empresaId, filters);
        return qb.orderBy('c.nombre_completo', 'ASC').take(10000).getMany();
    }
};
exports.ClienteRepository = ClienteRepository;
exports.ClienteRepository = ClienteRepository = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_2.InjectDataSource)()),
    __metadata("design:paramtypes", [typeorm_1.DataSource])
], ClienteRepository);
//# sourceMappingURL=cliente.repository.js.map