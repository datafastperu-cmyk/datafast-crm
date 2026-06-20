import { Injectable } from '@nestjs/common';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Factura, EstadoFactura } from '../entities/factura.entity';
import { FilterFacturaDto } from '../dto/factura.dto';
import { paginate, PaginatedResult } from '../../../common/utils/pagination.util';

@Injectable()
export class FacturaRepository {
  private readonly repo: Repository<Factura>;

  constructor(@InjectDataSource() private readonly ds: DataSource) {
    this.repo = ds.getRepository(Factura);
  }

  // ── CRUD básico ────────────────────────────────────────────
  create(data: Partial<Factura>): Factura { return this.repo.create(data); }
  async save(f: Factura): Promise<Factura> { return this.repo.save(f); }
  async update(id: string, data: Partial<Factura>): Promise<void> {
    await this.repo.update({ id }, data);
  }
  async delete(id: string): Promise<void> {
    await this.repo.delete({ id });
  }

  async findById(id: string, empresaId: string): Promise<Factura | null> {
    return this.repo.findOne({ where: { id, empresaId, deletedAt: null as any } });
  }

  async findByContrato(contratoId: string, empresaId: string): Promise<Factura[]> {
    return this.repo.find({
      where: { contratoId, empresaId, deletedAt: null as any },
      order: { fechaEmision: 'DESC' },
    });
  }

  async findByCliente(clienteId: string, empresaId: string): Promise<Factura[]> {
    return this.repo.find({
      where: { clienteId, empresaId, deletedAt: null as any },
      order: { fechaEmision: 'DESC' },
      take: 50,
    });
  }

  // ── Listado paginado con filtros ───────────────────────────
  // ── Listado paginado con filtros ───────────────────────────
  async findAllPaginated(
    empresaId: string,
    filters: FilterFacturaDto,
  ): Promise<PaginatedResult<any>> {
    const page   = filters.page  ?? 1;
    const limit  = filters.limit ?? 20;
    const offset = (page - 1) * limit;

    const allowedSort: Record<string, string> = {
      createdAt:        'f.created_at',
      fechaEmision:     'f.fecha_emision',
      fechaVencimiento: 'f.fecha_vencimiento',
      total:            'f.total',
      estado:           'f.estado',
      serie:            'f.serie',
      correlativo:      'f.correlativo',
    };
    const sortCol = allowedSort[filters.sortBy ?? ''] ?? 'f.created_at';
    const sortDir = filters.sortOrder === 'ASC' ? 'ASC' : 'DESC';

    const conds: string[] = ['f.empresa_id = $1', 'f.deleted_at IS NULL'];
    const params: any[]   = [empresaId];

    if (filters.search) {
      params.push(`%${filters.search}%`);
      conds.push(`(f.numero_completo ILIKE $${params.length} OR f.descripcion ILIKE $${params.length})`);
    }
    if (filters.estado) {
      params.push(filters.estado);
      conds.push(`f.estado = $${params.length}`);
    }
    if (filters.estados?.length) {
      params.push(filters.estados);
      conds.push(`f.estado = ANY($${params.length})`);
    }
    if (filters.clienteId) {
      params.push(filters.clienteId);
      conds.push(`f.cliente_id = $${params.length}`);
    }
    if (filters.contratoId) {
      params.push(filters.contratoId);
      conds.push(`f.contrato_id = $${params.length}`);
    }
    if (filters.tipoComprobante) {
      params.push(filters.tipoComprobante);
      conds.push(`f.tipo_comprobante = $${params.length}`);
    }
    if (filters.serie) {
      params.push(filters.serie);
      conds.push(`f.serie = $${params.length}`);
    }
    if (filters.fechaDesde) {
      params.push(filters.fechaDesde);
      conds.push(`f.fecha_emision >= $${params.length}`);
    }
    if (filters.fechaHasta) {
      params.push(filters.fechaHasta);
      conds.push(`f.fecha_emision <= $${params.length}`);
    }
    if (filters.vencidas)
      conds.push("f.fecha_vencimiento < CURRENT_DATE AND f.estado NOT IN ('pagada','anulada')");
    if (filters.automatica !== undefined) {
      params.push(filters.automatica);
      conds.push(`f.generada_automaticamente = $${params.length}`);
    }

    const where = conds.join(' AND ');

    const [{ total }] = await this.ds.query(
      `SELECT COUNT(*) AS total FROM facturas f WHERE ${where}`,
      params,
    );

    const data = await this.ds.query(`
      SELECT
        f.id,
        f.empresa_id               AS "empresaId",
        f.cliente_id               AS "clienteId",
        f.contrato_id              AS "contratoId",
        f.tipo_comprobante         AS "tipoComprobante",
        f.serie,
        f.correlativo,
        f.numero_completo          AS "numeroCompleto",
        f.descripcion,
        f.periodo_inicio           AS "periodoInicio",
        f.periodo_fin              AS "periodoFin",
        f.estado,
        f.fecha_emision            AS "fechaEmision",
        f.fecha_vencimiento        AS "fechaVencimiento",
        f.fecha_pago               AS "fechaPago",
        f.pdf_url                  AS "pdfUrl",
        f.sunat_enviada            AS "sunatEnviada",
        f.sunat_aceptada           AS "sunatAceptada",
        f.generada_automaticamente AS "generadaAutomaticamente",
        f.created_at               AS "createdAt",
        CAST(f.subtotal     AS FLOAT) AS "subtotal",
        CAST(f.descuento    AS FLOAT) AS "descuento",
        CAST(f.igv          AS FLOAT) AS "igv",
        CAST(f.total        AS FLOAT) AS "total",
        CAST(f.monto_pagado AS FLOAT) AS "montoPagado",
        CAST(f.saldo        AS FLOAT) AS "saldo",
        cl.nombre_completo         AS "clienteNombre",
        cl.numero_documento        AS "clienteDocumento"
      FROM facturas f
      LEFT JOIN clientes cl ON cl.id = f.cliente_id AND cl.deleted_at IS NULL
      WHERE ${where}
      ORDER BY ${sortCol} ${sortDir}
      LIMIT ${limit} OFFSET ${offset}
    `, params);

    return { data, total: parseInt(total, 10), page, limit };
  }

  buildFilterQuery(empresaId: string, f: FilterFacturaDto): SelectQueryBuilder<Factura> {
    const qb = this.repo.createQueryBuilder('f')
      .where('f.empresa_id = :empresaId', { empresaId })
      .andWhere('f.deleted_at IS NULL');

    if (f.search) {
      qb.andWhere(
        '(f.numero_completo ILIKE :s OR f.descripcion ILIKE :s)',
        { s: `%${f.search}%` },
      );
    }
    if (f.estado)             qb.andWhere('f.estado = :estado', { estado: f.estado });
    if (f.estados?.length)    qb.andWhere('f.estado IN (:...estados)', { estados: f.estados });
    if (f.clienteId)          qb.andWhere('f.cliente_id = :clienteId', { clienteId: f.clienteId });
    if (f.contratoId)         qb.andWhere('f.contrato_id = :contratoId', { contratoId: f.contratoId });
    if (f.tipoComprobante)    qb.andWhere('f.tipo_comprobante = :tc', { tc: f.tipoComprobante });
    if (f.serie)              qb.andWhere('f.serie = :serie', { serie: f.serie });
    if (f.fechaDesde)         qb.andWhere('f.fecha_emision >= :fd', { fd: f.fechaDesde });
    if (f.fechaHasta)         qb.andWhere('f.fecha_emision <= :fh', { fh: f.fechaHasta });
    if (f.vencidas)           qb.andWhere("f.fecha_vencimiento < CURRENT_DATE AND f.estado NOT IN ('pagada','anulada')");
    if (f.automatica !== undefined) qb.andWhere('f.generada_automaticamente = :auto', { auto: f.automatica });

    return qb;
  }

  /**
   * @deprecated No tiene protección contra race conditions.
   * Usar ComprobantesConfigService.siguienteCorrelativo() que usa UPDATE…RETURNING atómico.
   */
  async siguienteCorrelativo(empresaId: string, serie: string): Promise<number> {
    const result = await this.ds.query(`
      SELECT COALESCE(MAX(correlativo), 0) + 1 AS siguiente
      FROM facturas
      WHERE empresa_id = $1 AND serie = $2 AND deleted_at IS NULL
    `, [empresaId, serie]);
    return parseInt(result[0]?.siguiente ?? '1', 10);
  }

  // ── Verificar factura duplicada en mismo periodo ───────────
  async existeFacturaPeriodo(
    contratoId: string,
    periodoInicio: string,
    periodoFin: string,
  ): Promise<boolean> {
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

  async existeFacturaClientePeriodo(
    clienteId: string,
    periodoInicio: string,
    periodoFin: string,
  ): Promise<boolean> {
    const count = await this.repo
      .createQueryBuilder('f')
      .where('f.cliente_id = :clienteId', { clienteId })
      .andWhere('f.periodo_inicio = :pi', { pi: periodoInicio })
      .andWhere('f.periodo_fin = :pf', { pf: periodoFin })
      .andWhere("f.estado != 'anulada'")
      .andWhere('f.deleted_at IS NULL')
      .getCount();
    return count > 0;
  }

  // ── Contratos que requieren factura este mes ───────────────
  async findContratosParaFacturar(
    empresaId: string,
    mes: number,
    anio: number,
    soloContratoId?: string,
    soloDia?: number,
  ): Promise<any[]> {
    let query = `
      SELECT
        co.id                   AS contrato_id,
        co.numero_contrato,
        CAST(co.precio_final AS FLOAT) AS precio,
        CAST(co.descuento_pct AS FLOAT) AS descuento_pct,
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
        CAST(em.igv_rate AS FLOAT) AS igv_rate,
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
    const params: any[] = [empresaId];

    if (soloContratoId) {
      query += ` AND co.id = $${params.length + 1}`;
      params.push(soloContratoId);
    }

    if (soloDia !== undefined) {
      query += ` AND co.dia_facturacion = $${params.length + 1}`;
      params.push(soloDia);
    }

    query += ' ORDER BY co.dia_facturacion, cl.nombre_completo';
    return this.ds.query(query, params);
  }

  // ── Facturas vencidas (para marcar como vencidas) ─────────
  async findFacturasParaVencer(): Promise<Factura[]> {
    return this.repo.createQueryBuilder('f')
      .where("f.estado IN ('emitida', 'pagada_parcial')")
      .andWhere('f.fecha_vencimiento < CURRENT_DATE')
      .andWhere('f.deleted_at IS NULL')
      .getMany();
  }

  // ── Facturas pendientes de un contrato (para deuda) ───────
  async findPendientesPorContrato(contratoId: string): Promise<Factura[]> {
    return this.repo.createQueryBuilder('f')
      .where('f.contrato_id = :contratoId', { contratoId })
      .andWhere("f.estado IN ('emitida', 'pagada_parcial', 'vencida', 'en_cobranza')")
      .andWhere('f.deleted_at IS NULL')
      .orderBy('f.fecha_emision', 'ASC')
      .getMany();
  }

  // ── Resumen financiero para dashboard ─────────────────────
  async getResumenFinanciero(empresaId: string): Promise<Record<string, any>> {
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

  // ── Soft delete ───────────────────────────────────────────
  async softDelete(id: string): Promise<void> {
    await this.repo.update({ id }, { deletedAt: new Date() });
  }
}
