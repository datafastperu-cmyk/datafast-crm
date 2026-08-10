import { Injectable } from '@nestjs/common';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Factura, EstadoFactura } from '../entities/factura.entity';
import { FilterFacturaDto } from '../dto/factura.dto';
import { paginate, PaginatedResult } from '../../../common/utils/pagination.util';
import { sqlDeudaExigible } from '../domain/estados-con-saldo';

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
      where: { servicioId: contratoId, empresaId, deletedAt: null as any },
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
      conds.push(`f.servicio_id = $${params.length}`);
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
        f.servicio_id              AS "servicioId",
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
    if (f.contratoId)         qb.andWhere('f.servicio_id = :servicioId', { servicioId: f.contratoId });
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
      .where('f.servicio_id = :servicioId', { servicioId: contratoId })
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

  /**
   * Pares `clienteId|fechaVencimiento` ya facturados en una ventana, en UNA sola consulta.
   *
   * La generación masiva preguntaba cliente por cliente con `existeFacturaClientePeriodo`
   * dentro del bucle: un roundtrip por abonado. Con los 5000+ que se está dimensionando,
   * son 5000 consultas secuenciales antes de emitir la primera factura. Aquí se resuelve
   * con una, y el bucle solo consulta un Set en memoria.
   *
   * **La clave es el VENCIMIENTO, no el periodo** (cambiado el 2026-08-08). Antes se
   * comparaba `periodo_inicio`/`periodo_fin` exactos, lo cual funcionaba solo mientras el
   * periodo era el mismo mes de calendario para todo el parque. Ahora cada abonado tiene su
   * propio ciclo —del día siguiente a su fecha de pago hasta la siguiente—, así que dos
   * clientes distintos tienen periodos distintos y comparar por periodo dejó de identificar
   * nada. El vencimiento sí: **un comprobante vivo por abonado y fecha de pago**, que es la
   * regla de negocio real y no depende de cómo se decida nombrar el periodo mañana.
   */
  async clientesYaFacturados(
    empresaId: string,
    vencimientoDesde: string,
    vencimientoHasta: string,
  ): Promise<Set<string>> {
    const filas = await this.repo.manager.query<Array<{ clave: string }>>(
      `SELECT DISTINCT cliente_id || '|' || fecha_vencimiento::text AS clave
         FROM facturas
        WHERE empresa_id = $1
          AND fecha_vencimiento BETWEEN $2::date AND $3::date
          AND estado <> 'anulada'
          AND deleted_at IS NULL`,
      [empresaId, vencimientoDesde, vencimientoHasta],
    );
    return new Set(filas.map((f) => f.clave));
  }

  // ── Contratos que requieren factura este mes ───────────────
  async findContratosParaFacturar(
    empresaId: string,
    mes: number,
    anio: number,
    soloContratoId?: string,
    soloDia?: number,
    desdeActividad?: string,
  ): Promise<any[]> {
    let query = `
      SELECT
        co.id                   AS contrato_id,
        co.numero_contrato,
        -- Va al detalle del comprobante: con un consolidado, dos servicios del MISMO
        -- plan solo se distinguen por su contrato y su dirección de instalación.
        co.direccion_instalacion,
        CAST(co.precio_final AS FLOAT) AS precio,
        CAST(co.descuento_pct AS FLOAT) AS descuento_pct,
        co.dia_facturacion,
        co.cliente_id,
        -- H-6: el estado decide en prepago (¿sigue en pie el servicio?) y el historial
        -- decide en postpago (¿cuántos días se entregaron?).
        co.estado,
        co.empresa_id,

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
        -- serie_boleta, serie_factura e igv_rate se migraron de empresas a
        -- comprobantes_config / configuracion_facturacion, pero seguian en este
        -- SELECT: la query fallaba entera con "column em.serie_boleta does not exist",
        -- y con ella TODA la generacion de facturas. El consumidor ya los lee de
        -- configGlobal (ver facturacion.service.ts: "IGV leido de configGlobal, no del
        -- primer contrato del lote"), asi que eran campos muertos.
        em.dias_gracia,
        em.razon_social         AS empresa_nombre,
        em.ruc                  AS empresa_ruc,
        em.direccion_fiscal     AS empresa_direccion
      FROM servicios co
      JOIN clientes cl ON cl.id = co.cliente_id
      JOIN planes   pl ON pl.id = co.plan_id
      JOIN empresas em ON em.id = co.empresa_id
      WHERE co.empresa_id = $1
        -- HISTORIA, para que no se reintroduzca: aquí hubo un "estado IN ('activo', 'prorroga')".
        -- 'prorroga' NO existe en el enum estado_contrato —una prórroga mantiene el contrato en
        -- 'activo' con en_prorroga = true—, y Postgres no devuelve menos filas: rechaza la consulta
        -- ENTERA. No se emitía ni una factura. Estuvo latente mientras la generación corría una vez
        -- al mes; al pasar a evaluarse a diario (05/08) empezó a fallar cada madrugada. Lo cubre
        -- "estados-sql-validos.spec.ts".
        -- H-6 (2026-08-09): ya NO se filtra por "estado = 'activo'".
        --
        -- Filtrar por el estado de HOY dejaba fuera a los suspendidos, y con ellos el tramo del
        -- ciclo que SÍ se les entregó antes del corte: ocho días de servicio real que no se
        -- cobraban nunca, porque el comprobante siguiente ya cubría el mes siguiente. Lo que
        -- decide ahora es el TIEMPO ENTREGADO, y eso se calcula fuera de esta consulta.
        --
        -- Se sigue acotando para no arrastrar contratos inertes: quien no está activo hoy solo
        -- entra si su estado cambió dentro de la ventana que puede solapar el ciclo. Un contrato
        -- suspendido desde hace meses tiene cero días entregados, y no hace falta traerlo para
        -- descubrirlo. "fecha_estado" puede ser nula en filas antiguas, de ahí el COALESCE.
        AND (co.estado = 'activo'
             OR ($2 IS NULL OR COALESCE(co.fecha_estado, co.created_at) >= $2::date))
        AND co.deleted_at IS NULL
        AND cl.deleted_at IS NULL
    `;
    // $2 va SIEMPRE, aunque sea null: los filtros opcionales de abajo se numeran con
    // params.length y desplazarlos según haya o no ventana sería una fuente de bugs.
    const params: any[] = [empresaId, desdeActividad ?? null];

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
      .where('f.servicio_id = :servicioId', { servicioId: contratoId })
      .andWhere(sqlDeudaExigible('f'))
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
          WHERE ${sqlDeudaExigible('f')}
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
  /**
   * Historial de estados necesario para saber cuántos días de un ciclo estuvo cada contrato
   * activo (H-6). Devuelve, por contrato, todas las transiciones hasta `fin` inclusive; el
   * consumidor separa la última anterior al ciclo —que da el estado de partida— de las de dentro.
   *
   * **La fecha se resuelve en la zona horaria del operador, no en la de la sesión de Postgres.**
   * Un corte a las 20:00 en Lima es el 8 en UTC y el 7 en Lima; sin `AT TIME ZONE` el día
   * facturado dependería de cómo estuviera configurada la conexión, que es exactamente la clase
   * de dependencia ambiental que no debe decidir dinero.
   */
  async historialParaCiclo(
    contratoIds: string[],
    fin: string,
  ): Promise<Array<{ servicio_id: string; estado_nuevo: string; fecha: string }>> {
    if (!contratoIds.length) return [];
    return this.ds.query(
      `SELECT ch.servicio_id,
              ch.estado_nuevo,
              TO_CHAR((ch.created_at AT TIME ZONE em.zona_horaria)::date, 'YYYY-MM-DD') AS fecha
         FROM servicios_historial ch
         JOIN servicios co ON co.id = ch.servicio_id
         JOIN empresas   em ON em.id = co.empresa_id
        WHERE ch.servicio_id = ANY($1)
          AND (ch.created_at AT TIME ZONE em.zona_horaria)::date <= $2::date
        ORDER BY ch.servicio_id, ch.created_at`,
      [contratoIds, fin],
    );
  }
}
