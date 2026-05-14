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
exports.PagoRepository = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("typeorm");
const typeorm_2 = require("@nestjs/typeorm");
const pago_entity_1 = require("../entities/pago.entity");
const pagination_util_1 = require("../../../common/utils/pagination.util");
let PagoRepository = class PagoRepository {
    constructor(ds) {
        this.ds = ds;
        this.repo = ds.getRepository(pago_entity_1.Pago);
        this.cuentaRepo = ds.getRepository(pago_entity_1.CuentaBancaria);
    }
    create(data) { return this.repo.create(data); }
    async save(p) { return this.repo.save(p); }
    async update(id, data) {
        await this.repo.update({ id }, { ...data, updatedAt: new Date() });
    }
    async findById(id, empresaId) {
        return this.repo.findOne({ where: { id, empresaId } });
    }
    async findByFactura(facturaId, empresaId) {
        return this.repo.find({
            where: { facturaId, empresaId },
            order: { registradoEn: 'DESC' },
        });
    }
    async findByContrato(contratoId, empresaId) {
        return this.repo.find({
            where: { contratoId, empresaId },
            order: { registradoEn: 'DESC' },
            take: 30,
        });
    }
    async findByCliente(clienteId, empresaId, limit = 20) {
        return this.repo.find({
            where: { clienteId, empresaId },
            order: { registradoEn: 'DESC' },
            take: limit,
        });
    }
    async findAllPaginated(empresaId, filters) {
        const qb = this.buildFilterQuery(empresaId, filters);
        return (0, pagination_util_1.paginate)(qb, filters, [
            'registradoEn', 'fechaPago', 'monto', 'estado', 'metodoPago',
        ]);
    }
    buildFilterQuery(empresaId, f) {
        const qb = this.repo.createQueryBuilder('p')
            .where('p.empresa_id = :empresaId', { empresaId });
        if (f.search)
            qb.andWhere('(p.numero_operacion ILIKE :s OR p.banco ILIKE :s)', { s: `%${f.search}%` });
        if (f.estado)
            qb.andWhere('p.estado = :estado', { estado: f.estado });
        if (f.metodoPago)
            qb.andWhere('p.metodo_pago = :mp', { mp: f.metodoPago });
        if (f.clienteId)
            qb.andWhere('p.cliente_id = :clienteId', { clienteId: f.clienteId });
        if (f.facturaId)
            qb.andWhere('p.factura_id = :facturaId', { facturaId: f.facturaId });
        if (f.contratoId)
            qb.andWhere('p.contrato_id = :contratoId', { contratoId: f.contratoId });
        if (f.cajeroId)
            qb.andWhere('p.cajero_id = :cajeroId', { cajeroId: f.cajeroId });
        if (f.banco)
            qb.andWhere('p.banco ILIKE :banco', { banco: `%${f.banco}%` });
        if (f.numeroOperacion)
            qb.andWhere('p.numero_operacion = :no', { no: f.numeroOperacion });
        if (f.conciliado !== undefined)
            qb.andWhere('p.conciliado = :c', { c: f.conciliado });
        if (f.soloHoy)
            qb.andWhere("p.fecha_pago = CURRENT_DATE");
        if (f.fechaDesde)
            qb.andWhere('p.fecha_pago >= :fd', { fd: f.fechaDesde });
        if (f.fechaHasta)
            qb.andWhere('p.fecha_pago <= :fh', { fh: f.fechaHasta });
        return qb;
    }
    async existeDuplicado(empresaId, metodoPago, numeroOperacion, excludeId) {
        const qb = this.repo.createQueryBuilder('p')
            .where('p.empresa_id = :empresaId', { empresaId })
            .andWhere('p.metodo_pago = :mp', { mp: metodoPago })
            .andWhere('p.numero_operacion = :no', { no: numeroOperacion });
        if (excludeId)
            qb.andWhere('p.id != :excludeId', { excludeId });
        const pagoExistente = await qb.getOne();
        return { existe: !!pagoExistente, pagoExistente };
    }
    async findByMpPaymentId(mpPaymentId) {
        return this.repo.findOne({ where: { mpPaymentId } });
    }
    async findPendientesVerificar(empresaId) {
        return this.repo.find({
            where: { empresaId, estado: pago_entity_1.EstadoPago.PENDIENTE_VERIFICACION },
            order: { registradoEn: 'ASC' },
            take: 100,
        });
    }
    async findVerificadosPeriodo(empresaId, fechaDesde, fechaHasta, banco) {
        const qb = this.repo.createQueryBuilder('p')
            .where('p.empresa_id = :empresaId', { empresaId })
            .andWhere('p.estado = :estado', { estado: pago_entity_1.EstadoPago.VERIFICADO })
            .andWhere('p.fecha_pago BETWEEN :fd AND :fh', { fd: fechaDesde, fh: fechaHasta });
        if (banco)
            qb.andWhere('p.banco ILIKE :banco', { banco: `%${banco}%` });
        return qb.orderBy('p.fecha_pago', 'ASC').addOrderBy('p.registrado_en', 'ASC').getMany();
    }
    async calcularDeudaContrato(contratoId) {
        const [result] = await this.ds.query(`
      SELECT
        COALESCE(SUM(f.saldo), 0)::DECIMAL AS deuda,
        COUNT(f.id)::INTEGER               AS meses
      FROM facturas f
      WHERE f.contrato_id = $1
        AND f.estado IN ('emitida','pagada_parcial','vencida','en_cobranza')
        AND f.deleted_at IS NULL
    `, [contratoId]);
        return {
            deuda: parseFloat(result?.deuda || '0'),
            meses: parseInt(result?.meses || '0', 10),
        };
    }
    async findFacturasPendientes(contratoId, empresaId) {
        return this.ds.query(`
      SELECT id, total, saldo, serie, correlativo, fecha_emision, fecha_vencimiento
      FROM facturas
      WHERE contrato_id = $1
        AND empresa_id  = $2
        AND estado IN ('emitida','pagada_parcial','vencida','en_cobranza')
        AND deleted_at IS NULL
      ORDER BY fecha_emision ASC
    `, [contratoId, empresaId]);
    }
    async getResumenCobranza(empresaId) {
        const [resumen] = await this.ds.query(`
      SELECT
        -- Hoy
        COALESCE(SUM(monto) FILTER (WHERE fecha_pago = CURRENT_DATE AND estado = 'verificado'), 0)         AS cobrado_hoy,
        COUNT(*)            FILTER (WHERE fecha_pago = CURRENT_DATE AND estado = 'verificado')              AS pagos_hoy,

        -- Semana
        COALESCE(SUM(monto) FILTER (WHERE fecha_pago >= CURRENT_DATE - INTERVAL '7 days' AND estado = 'verificado'), 0) AS cobrado_semana,
        COUNT(*)            FILTER (WHERE fecha_pago >= CURRENT_DATE - INTERVAL '7 days' AND estado = 'verificado')     AS pagos_semana,

        -- Mes actual
        COALESCE(SUM(monto) FILTER (
          WHERE DATE_TRUNC('month', fecha_pago::date) = DATE_TRUNC('month', CURRENT_DATE) AND estado = 'verificado'
        ), 0) AS cobrado_mes,
        COUNT(*) FILTER (
          WHERE DATE_TRUNC('month', fecha_pago::date) = DATE_TRUNC('month', CURRENT_DATE) AND estado = 'verificado'
        ) AS pagos_mes,

        -- Mes anterior
        COALESCE(SUM(monto) FILTER (
          WHERE DATE_TRUNC('month', fecha_pago::date) = DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month'
            AND estado = 'verificado'
        ), 0) AS cobrado_mes_anterior,

        -- Pendientes de verificar
        COUNT(*) FILTER (WHERE estado = 'pendiente_verificacion') AS pendientes_verificar

      FROM pagos
      WHERE empresa_id = $1
    `, [empresaId]);
        const porMetodo = await this.ds.query(`
      SELECT
        metodo_pago,
        COUNT(*)     AS total,
        SUM(monto)   AS monto
      FROM pagos
      WHERE empresa_id = $1
        AND estado = 'verificado'
        AND DATE_TRUNC('month', fecha_pago::date) = DATE_TRUNC('month', CURRENT_DATE)
      GROUP BY metodo_pago
    `, [empresaId]);
        return { ...resumen, porMetodo };
    }
    async findUltimos(empresaId, limit = 10) {
        return this.ds.query(`
      SELECT
        p.id, p.monto, p.metodo_pago, p.estado,
        p.fecha_pago, p.registrado_en,
        p.numero_operacion, p.banco,
        cl.nombre_completo AS cliente_nombre,
        cl.telefono        AS cliente_telefono
      FROM pagos p
      JOIN clientes cl ON cl.id = p.cliente_id
      WHERE p.empresa_id = $1
      ORDER BY p.registrado_en DESC
      LIMIT $2
    `, [empresaId, limit]);
    }
    async findCuentas(empresaId) {
        return this.cuentaRepo.find({
            where: { empresaId, activa: true },
            order: { esPrincipal: 'DESC', banco: 'ASC' },
        });
    }
    async saveCuenta(c) {
        return this.cuentaRepo.save(c);
    }
    async createCuenta(data) {
        return this.cuentaRepo.save(this.cuentaRepo.create(data));
    }
};
exports.PagoRepository = PagoRepository;
exports.PagoRepository = PagoRepository = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_2.InjectDataSource)()),
    __metadata("design:paramtypes", [typeorm_1.DataSource])
], PagoRepository);
//# sourceMappingURL=pago.repository.js.map