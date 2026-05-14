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
exports.FacturaRepository = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("typeorm");
const typeorm_2 = require("@nestjs/typeorm");
const factura_entity_1 = require("../entities/factura.entity");
const pagination_util_1 = require("../../../common/utils/pagination.util");
let FacturaRepository = class FacturaRepository {
    constructor(ds) {
        this.ds = ds;
        this.repo = ds.getRepository(factura_entity_1.Factura);
    }
    create(data) { return this.repo.create(data); }
    async save(f) { return this.repo.save(f); }
    async update(id, data) {
        await this.repo.update({ id }, data);
    }
    async findById(id, empresaId) {
        return this.repo.findOne({ where: { id, empresaId, deletedAt: null } });
    }
    async findByContrato(contratoId, empresaId) {
        return this.repo.find({
            where: { contratoId, empresaId, deletedAt: null },
            order: { fechaEmision: 'DESC' },
        });
    }
    async findByCliente(clienteId, empresaId) {
        return this.repo.find({
            where: { clienteId, empresaId, deletedAt: null },
            order: { fechaEmision: 'DESC' },
            take: 50,
        });
    }
    async findAllPaginated(empresaId, filters) {
        const qb = this.buildFilterQuery(empresaId, filters);
        return (0, pagination_util_1.paginate)(qb, filters, [
            'createdAt', 'fechaEmision', 'fechaVencimiento',
            'total', 'estado', 'serie', 'correlativo',
        ]);
    }
    buildFilterQuery(empresaId, f) {
        const qb = this.repo.createQueryBuilder('f')
            .where('f.empresa_id = :empresaId', { empresaId })
            .andWhere('f.deleted_at IS NULL');
        if (f.search) {
            qb.andWhere('(f.numero_completo ILIKE :s OR f.descripcion ILIKE :s)', { s: `%${f.search}%` });
        }
        if (f.estado)
            qb.andWhere('f.estado = :estado', { estado: f.estado });
        if (f.estados?.length)
            qb.andWhere('f.estado IN (:...estados)', { estados: f.estados });
        if (f.clienteId)
            qb.andWhere('f.cliente_id = :clienteId', { clienteId: f.clienteId });
        if (f.contratoId)
            qb.andWhere('f.contrato_id = :contratoId', { contratoId: f.contratoId });
        if (f.tipoComprobante)
            qb.andWhere('f.tipo_comprobante = :tc', { tc: f.tipoComprobante });
        if (f.serie)
            qb.andWhere('f.serie = :serie', { serie: f.serie });
        if (f.fechaDesde)
            qb.andWhere('f.fecha_emision >= :fd', { fd: f.fechaDesde });
        if (f.fechaHasta)
            qb.andWhere('f.fecha_emision <= :fh', { fh: f.fechaHasta });
        if (f.vencidas)
            qb.andWhere("f.fecha_vencimiento < CURRENT_DATE AND f.estado NOT IN ('pagada','anulada')");
        if (f.automatica !== undefined)
            qb.andWhere('f.generada_automaticamente = :auto', { auto: f.automatica });
        return qb;
    }
    async siguienteCorrelativo(empresaId, serie) {
        const result = await this.ds.query(`
      SELECT COALESCE(MAX(correlativo), 0) + 1 AS siguiente
      FROM facturas
      WHERE empresa_id = $1 AND serie = $2 AND deleted_at IS NULL
    `, [empresaId, serie]);
        return parseInt(result[0]?.siguiente ?? '1', 10);
    }
    async existeFacturaPeriodo(contratoId, periodoInicio, periodoFin) {
        const count = await this.repo
            .createQueryBuilder('f')
            .where('f.contrato_id = :contratoId', { contratoId })
            .andWhere('f.periodo_inicio = :pi', { pi: periodoInicio })
            .andWhere('f.periodo_fin = :pf', { pf: periodoFin })
            .andWhere("f.estado != 'anulada'")
            .andWhere('f.deleted_at IS NULL')
            .getCount();
        return count > 0;
    }
    async findContratosParaFacturar(empresaId, mes, anio, soloContratoId) {
        let query = `
      SELECT
        co.id                   AS contrato_id,
        co.numero_contrato,
        co.precio_final          AS precio,
        co.descuento_pct,
        co.dia_facturacion,
        co.cliente_id,
        co.empresa_id,
        pl.aplica_igv,
        pl.nombre               AS plan_nombre,
        cl.nombres              AS cliente_nombres,
        cl.apellido_paterno,
        cl.apellido_materno,
        cl.nombre_completo      AS cliente_nombre,
        cl.numero_documento     AS cliente_documento,
        cl.tipo_documento,
        cl.email                AS cliente_email,
        cl.telefono             AS cliente_telefono,
        cl.direccion            AS cliente_direccion,
        em.serie_boleta,
        em.serie_factura,
        em.igv_rate,
        em.dias_gracia,
        em.razon_social         AS empresa_nombre,
        em.ruc                  AS empresa_ruc,
        em.direccion_fiscal     AS empresa_direccion
      FROM contratos co
      JOIN clientes cl ON cl.id = co.cliente_id
      JOIN planes   pl ON pl.id = co.plan_id
      JOIN empresas em ON em.id = co.empresa_id
      WHERE co.empresa_id = $1
        AND co.estado IN ('activo', 'prorroga')
        AND co.deleted_at IS NULL
        AND cl.deleted_at IS NULL
    `;
        const params = [empresaId];
        if (soloContratoId) {
            query += ` AND co.id = $${params.length + 1}`;
            params.push(soloContratoId);
        }
        query += ' ORDER BY co.dia_facturacion, cl.nombre_completo';
        return this.ds.query(query, params);
    }
    async findFacturasParaVencer() {
        return this.repo.createQueryBuilder('f')
            .where("f.estado IN ('emitida', 'pagada_parcial')")
            .andWhere('f.fecha_vencimiento < CURRENT_DATE')
            .andWhere('f.deleted_at IS NULL')
            .getMany();
    }
    async findPendientesPorContrato(contratoId) {
        return this.repo.createQueryBuilder('f')
            .where('f.contrato_id = :contratoId', { contratoId })
            .andWhere("f.estado IN ('emitida', 'pagada_parcial', 'vencida', 'en_cobranza')")
            .andWhere('f.deleted_at IS NULL')
            .orderBy('f.fecha_emision', 'ASC')
            .getMany();
    }
    async getResumenFinanciero(empresaId) {
        const [resumen] = await this.ds.query(`
      SELECT
        -- Mes actual
        COALESCE(SUM(f.total) FILTER (
          WHERE DATE_TRUNC('month', f.fecha_emision::date) = DATE_TRUNC('month', CURRENT_DATE)
            AND f.estado != 'anulada'
        ), 0) AS facturado_mes,

        COALESCE(SUM(f.monto_pagado) FILTER (
          WHERE DATE_TRUNC('month', f.fecha_emision::date) = DATE_TRUNC('month', CURRENT_DATE)
        ), 0) AS cobrado_mes,

        -- Hoy
        COALESCE((
          SELECT SUM(p.monto)
          FROM pagos p
          WHERE p.empresa_id = $1
            AND p.fecha_pago = CURRENT_DATE
            AND p.estado = 'verificado'
        ), 0) AS cobrado_hoy,

        -- Mes anterior
        COALESCE((
          SELECT SUM(p.monto)
          FROM pagos p
          WHERE p.empresa_id = $1
            AND DATE_TRUNC('month', p.fecha_pago::date) =
                DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month'
            AND p.estado = 'verificado'
        ), 0) AS cobrado_mes_anterior,

        -- Cuentas por cobrar
        COALESCE(SUM(f.saldo) FILTER (
          WHERE f.estado IN ('emitida','pagada_parcial','vencida','en_cobranza')
        ), 0) AS cuentas_por_cobrar,

        -- Totales por estado
        COUNT(*) FILTER (WHERE f.estado != 'anulada')                AS total_emitidas,
        COUNT(*) FILTER (WHERE f.estado = 'pagada')                  AS total_pagadas,
        COUNT(*) FILTER (WHERE f.estado = 'anulada')                 AS total_anuladas,
        COUNT(*) FILTER (
          WHERE f.fecha_vencimiento < CURRENT_DATE
            AND f.estado NOT IN ('pagada','anulada')
        ) AS facturas_vencidas

      FROM facturas f
      WHERE f.empresa_id = $1 AND f.deleted_at IS NULL
    `, [empresaId]);
        return resumen;
    }
    async softDelete(id) {
        await this.repo.update({ id }, { deletedAt: new Date() });
    }
};
exports.FacturaRepository = FacturaRepository;
exports.FacturaRepository = FacturaRepository = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_2.InjectDataSource)()),
    __metadata("design:paramtypes", [typeorm_1.DataSource])
], FacturaRepository);
//# sourceMappingURL=factura.repository.js.map