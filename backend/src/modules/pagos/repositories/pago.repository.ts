import { Injectable } from '@nestjs/common';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Pago, EstadoPago, MetodoPago, CuentaBancaria } from '../entities/pago.entity';
import { FilterPagoDto } from '../dto/pago.dto';
import { paginate, PaginatedResult } from '../../../common/utils/pagination.util';

@Injectable()
export class PagoRepository {
  private readonly repo:   Repository<Pago>;
  private readonly cuentaRepo: Repository<CuentaBancaria>;

  constructor(@InjectDataSource() private readonly ds: DataSource) {
    this.repo      = ds.getRepository(Pago);
    this.cuentaRepo = ds.getRepository(CuentaBancaria);
  }

  // ── CRUD ───────────────────────────────────────────────────
  create(data: Partial<Pago>): Pago { return this.repo.create(data); }

  async save(p: Pago): Promise<Pago> { return this.repo.save(p); }

  async update(id: string, data: Partial<Pago>): Promise<void> {
    await this.repo.update({ id }, { ...data, updatedAt: new Date() });
  }

  async findById(id: string, empresaId: string): Promise<Pago | null> {
    return this.repo.findOne({ where: { id, empresaId } });
  }

  async findByFactura(facturaId: string, empresaId: string): Promise<Pago[]> {
    return this.repo.find({
      where: { facturaId, empresaId },
      order: { registradoEn: 'DESC' },
    });
  }

  async findByContrato(contratoId: string, empresaId: string): Promise<Pago[]> {
    return this.repo.find({
      where: { contratoId, empresaId },
      order: { registradoEn: 'DESC' },
      take: 30,
    });
  }

  async findByCliente(clienteId: string, empresaId: string, limit = 20): Promise<Pago[]> {
    return this.repo.find({
      where: { clienteId, empresaId },
      order: { registradoEn: 'DESC' },
      take: limit,
    });
  }

  // ── Listado paginado con filtros ───────────────────────────
  async findAllPaginated(
    empresaId: string,
    filters: FilterPagoDto,
  ): Promise<PaginatedResult<Pago>> {
    const qb = this.buildFilterQuery(empresaId, filters);
    return paginate(qb, filters, [
      'registradoEn', 'fechaPago', 'monto', 'estado', 'metodoPago',
    ]);
  }

  buildFilterQuery(empresaId: string, f: FilterPagoDto): SelectQueryBuilder<Pago> {
    const qb = this.repo.createQueryBuilder('p')
      .where('p.empresa_id = :empresaId', { empresaId });

    // JOINs opcionales — sólo se añaden si algún filtro los requiere
    const needsContrato = !!(f.routerId);
    const needsCliente  = !!(f.sectorId);

    if (needsContrato) qb.leftJoin('contratos', 'co', 'co.id = p.contrato_id');
    if (needsCliente)  qb.leftJoin('clientes',  'cl', 'cl.id = p.cliente_id');

    if (f.search)          qb.andWhere('(p.numero_operacion ILIKE :s OR p.banco ILIKE :s)', { s: `%${f.search}%` });
    if (f.estado)          qb.andWhere('p.estado = :estado', { estado: f.estado });
    if (f.metodoPago)      qb.andWhere('p.metodo_pago = :mp', { mp: f.metodoPago });
    if (f.clienteId)       qb.andWhere('p.cliente_id = :clienteId', { clienteId: f.clienteId });
    if (f.facturaId)       qb.andWhere('p.factura_id = :facturaId', { facturaId: f.facturaId });
    if (f.contratoId)      qb.andWhere('p.contrato_id = :contratoId', { contratoId: f.contratoId });
    if (f.cajeroId)        qb.andWhere('p.cajero_id = :cajeroId', { cajeroId: f.cajeroId });
    if (f.banco)           qb.andWhere('p.banco ILIKE :banco', { banco: `%${f.banco}%` });
    if (f.numeroOperacion) qb.andWhere('p.numero_operacion ILIKE :no', { no: `%${f.numeroOperacion}%` });
    if (f.sectorId)        qb.andWhere('cl.zona_id = :sectorId', { sectorId: f.sectorId });
    if (f.routerId)        qb.andWhere('co.router_id = :routerId', { routerId: f.routerId });
    if (f.conciliado !== undefined) qb.andWhere('p.conciliado = :c', { c: f.conciliado });
    if (f.soloHoy)         qb.andWhere("p.fecha_pago = CURRENT_DATE");

    const desde = f.fechaDesde || f.fechaInicio;
    const hasta = f.fechaHasta || f.fechaFin;
    if (desde) qb.andWhere('p.fecha_pago >= :fd', { fd: desde });
    if (hasta) qb.andWhere('p.fecha_pago <= :fh', { fh: hasta });

    return qb;
  }

  // ── Detección de duplicados ────────────────────────────────
  /**
   * Verificar si ya existe un pago con el mismo número de operación.
   * Es la principal defensa contra pagos dobles.
   */
  async existeDuplicado(
    empresaId:       string,
    metodoPago:      MetodoPago,
    numeroOperacion: string,
    excludeId?:      string,
  ): Promise<{ existe: boolean; pagoExistente?: Pago }> {
    const qb = this.repo.createQueryBuilder('p')
      .where('p.empresa_id = :empresaId', { empresaId })
      .andWhere('p.metodo_pago = :mp', { mp: metodoPago })
      .andWhere('p.numero_operacion = :no', { no: numeroOperacion });

    if (excludeId) qb.andWhere('p.id != :excludeId', { excludeId });

    const pagoExistente = await qb.getOne();
    return { existe: !!pagoExistente, pagoExistente };
  }

  // ── Buscar por payment_id de MercadoPago ──────────────────
  async findByMpPaymentId(mpPaymentId: string): Promise<Pago | null> {
    return this.repo.findOne({ where: { mpPaymentId } });
  }

  // ── Pagos pendientes de verificar ─────────────────────────
  async findPendientesVerificar(empresaId: string): Promise<Pago[]> {
    return this.repo.find({
      where: { empresaId, estado: EstadoPago.PENDIENTE_VERIFICACION },
      order: { registradoEn: 'ASC' }, // Primero los más antiguos
      take: 100,
    });
  }

  // ── Pagos verificados de un periodo (para conciliación) ───
  async findVerificadosPeriodo(
    empresaId:  string,
    fechaDesde: string,
    fechaHasta: string,
    banco?:     string,
  ): Promise<Pago[]> {
    const qb = this.repo.createQueryBuilder('p')
      .where('p.empresa_id = :empresaId', { empresaId })
      .andWhere('p.estado = :estado', { estado: EstadoPago.VERIFICADO })
      .andWhere('p.fecha_pago BETWEEN :fd AND :fh', { fd: fechaDesde, fh: fechaHasta });

    if (banco) qb.andWhere('p.banco ILIKE :banco', { banco: `%${banco}%` });

    return qb.orderBy('p.fecha_pago', 'ASC').addOrderBy('p.registrado_en', 'ASC').getMany();
  }

  // ── Deuda total de un contrato (facturas pendientes) ──────
  async calcularDeudaContrato(contratoId: string): Promise<{ deuda: number; meses: number }> {
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
      meses: parseInt(result?.meses  || '0', 10),
    };
  }

  // ── Facturas pendientes del contrato ──────────────────────
  async findFacturasPendientes(
    contratoId: string,
    empresaId:  string,
  ): Promise<Array<{ id: string; total: number; saldo: number; serie: string; correlativo: number }>> {
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

  // ── Dashboard de cobranza ─────────────────────────────────
  async getResumenCobranza(empresaId: string): Promise<Record<string, any>> {
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

    // Por método de pago
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

  // ── Últimos pagos (para activity feed del dashboard) ──────
  async findUltimos(empresaId: string, limit = 10): Promise<any[]> {
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

  // ── Cuentas bancarias ─────────────────────────────────────
  async findCuentas(empresaId: string): Promise<CuentaBancaria[]> {
    return this.cuentaRepo.find({
      where: { empresaId, activa: true },
      order: { esPrincipal: 'DESC', banco: 'ASC' },
    });
  }

  async saveCuenta(c: CuentaBancaria): Promise<CuentaBancaria> {
    return this.cuentaRepo.save(c);
  }

  async createCuenta(data: Partial<CuentaBancaria>): Promise<CuentaBancaria> {
    return this.cuentaRepo.save(this.cuentaRepo.create(data));
  }
}
