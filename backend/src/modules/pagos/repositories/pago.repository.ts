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
    f: FilterPagoDto,
  ): Promise<PaginatedResult<any>> {
    const page   = f.page  ?? 1;
    const limit  = f.limit ?? 20;
    const offset = (page - 1) * limit;

    const conds: string[] = ['p.empresa_id = $1'];
    const params: any[]   = [empresaId];
    let   idx             = 2;

    if (f.search)    { conds.push(`(p.numero_operacion ILIKE $${idx} OR p.banco ILIKE $${idx})`); params.push(`%${f.search}%`); idx++; }
    if (f.estado)    { conds.push(`p.estado = $${idx++}`);        params.push(f.estado); }
    if (f.metodoPago){ conds.push(`p.metodo_pago = $${idx++}`);   params.push(f.metodoPago); }
    if (f.clienteId) { conds.push(`p.cliente_id = $${idx++}`);    params.push(f.clienteId); }
    if (f.facturaId) { conds.push(`p.factura_id = $${idx++}`);    params.push(f.facturaId); }
    if (f.contratoId){ conds.push(`p.contrato_id = $${idx++}`);   params.push(f.contratoId); }
    if (f.cajeroId)  { conds.push(`p.cajero_id = $${idx++}`);     params.push(f.cajeroId); }
    if (f.banco)     { conds.push(`p.banco ILIKE $${idx++}`);     params.push(`%${f.banco}%`); }
    if (f.numeroOperacion) { conds.push(`p.numero_operacion ILIKE $${idx++}`); params.push(`%${f.numeroOperacion}%`); }
    if (f.sectorId)  { conds.push(`cl.zona_id = $${idx++}`);      params.push(f.sectorId); }
    if (f.routerId)  { conds.push(`co.router_id = $${idx++}`);    params.push(f.routerId); }
    if (f.conciliado !== undefined) { conds.push(`p.conciliado = $${idx++}`); params.push(f.conciliado); }
    if (f.soloHoy)   { conds.push(`p.fecha_pago = CURRENT_DATE`); }

    const desde = f.fechaDesde || f.fechaInicio;
    const hasta = f.fechaHasta || f.fechaFin;
    if (desde) { conds.push(`p.fecha_pago >= $${idx++}`); params.push(desde); }
    if (hasta) { conds.push(`p.fecha_pago <= $${idx++}`); params.push(hasta); }

    const where = conds.join(' AND ');

    const allowed: Record<string, string> = {
      registradoEn: 'p.registrado_en',
      fechaPago:    'p.fecha_pago',
      monto:        'p.monto',
      estado:       'p.estado',
      metodoPago:   'p.metodo_pago',
    };
    const sortCol = allowed[f.sortBy ?? ''] ?? 'p.registrado_en';
    const sortDir = f.sortOrder === 'ASC' ? 'ASC' : 'DESC';

    const [countRow] = await this.ds.query(
      `SELECT COUNT(*) AS total
       FROM pagos p
       LEFT JOIN clientes cl ON cl.id = p.cliente_id
       LEFT JOIN contratos co ON co.id = p.contrato_id
       WHERE ${where}`,
      params,
    );
    const total = parseInt(countRow?.total ?? '0', 10);

    const data = await this.ds.query(
      `SELECT
         p.id, p.empresa_id, p.cliente_id, p.factura_id, p.contrato_id,
         p.monto, p.moneda, p.metodo_pago, p.banco, p.numero_operacion,
         p.numero_cuenta, p.estado, p.verificado_por, p.verificado_en,
         p.motivo_rechazo, p.comprobante_url, p.mp_payment_id, p.mp_status,
         p.fecha_pago, p.registrado_en, p.cajero_id, p.notas,
         p.conciliado, p.conciliado_en, p.conciliado_por, p.extracto_banco_ref,
         p.created_at, p.updated_at,
         COALESCE(
           cl.nombre_completo,
           NULLIF(TRIM(CONCAT_WS(' ', cl.nombres, cl.apellido_paterno, cl.apellido_materno)), '')
         ) AS cliente_nombre,
         f.numero_completo AS numero_comprobante
       FROM pagos p
       LEFT JOIN clientes cl ON cl.id = p.cliente_id
       LEFT JOIN contratos co ON co.id = p.contrato_id
       LEFT JOIN facturas f ON f.id = p.factura_id AND f.deleted_at IS NULL
       WHERE ${where}
       ORDER BY ${sortCol} ${sortDir}
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset],
    );

    return { data, total, page, limit };
  }

  buildFilterQuery(empresaId: string, f: FilterPagoDto): SelectQueryBuilder<Pago> {
    const qb = this.repo.createQueryBuilder('p')
      .where('p.empresa_id = :empresaId', { empresaId });

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
