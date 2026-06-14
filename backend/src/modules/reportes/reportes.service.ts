import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';

@Injectable()
export class ReportesService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  // ── Resumen general KPIs ──────────────────────────────────
  async getResumenGeneral(empresaId: string) {
    const [cobranza] = await this.ds.query(`
      SELECT
        COALESCE(SUM(total) FILTER (WHERE DATE_TRUNC('month', fecha_emision::date) = DATE_TRUNC('month', NOW()) AND estado != 'anulada'), 0) AS facturado_mes,
        COALESCE(SUM(monto_pagado) FILTER (WHERE DATE_TRUNC('month', fecha_emision::date) = DATE_TRUNC('month', NOW())), 0) AS cobrado_mes,
        COUNT(*) FILTER (WHERE estado NOT IN ('pagada','anulada') AND fecha_vencimiento < CURRENT_DATE) AS facturas_vencidas
      FROM facturas WHERE empresa_id = $1 AND deleted_at IS NULL
    `, [empresaId]);

    const [clientes] = await this.ds.query(`
      SELECT
        COUNT(*) FILTER (WHERE estado = 'activo') AS activos,
        COUNT(*) FILTER (WHERE estado = 'suspendido') AS suspendidos,
        COUNT(*) FILTER (WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())) AS nuevos_mes
      FROM clientes WHERE empresa_id = $1 AND deleted_at IS NULL
    `, [empresaId]);

    const [red] = await this.ds.query(`
      SELECT
        COUNT(*) FILTER (WHERE estado = 'online') AS online,
        COUNT(*) FILTER (WHERE estado = 'offline') AS offline,
        COUNT(*) AS total
      FROM nodos WHERE empresa_id = $1 AND activo = true
    `, [empresaId]);

    const [tickets] = await this.ds.query(`
      SELECT
        COUNT(*) FILTER (WHERE estado NOT IN ('cerrado','cancelado')) AS abiertos,
        COUNT(*) FILTER (WHERE prioridad = 'critica' AND estado NOT IN ('resuelto','cerrado','cancelado')) AS criticos
      FROM tickets WHERE empresa_id = $1 AND deleted_at IS NULL
    `, [empresaId]);

    return {
      cobranza: {
        facturadoMes:    Number(cobranza.facturado_mes)    || 0,
        cobradoMes:      Number(cobranza.cobrado_mes)      || 0,
        facturasVencidas: Number(cobranza.facturas_vencidas) || 0,
      },
      clientes: {
        activos:    Number(clientes.activos)    || 0,
        suspendidos: Number(clientes.suspendidos) || 0,
        nuevosMes:  Number(clientes.nuevos_mes) || 0,
      },
      red: {
        online:  Number(red.online)  || 0,
        offline: Number(red.offline) || 0,
        total:   Number(red.total)   || 0,
      },
      tickets: {
        abiertos: Number(tickets.abiertos) || 0,
        criticos: Number(tickets.criticos) || 0,
      },
    };
  }

  // ── Reporte Cobranza ──────────────────────────────────────
  async getCobranza(empresaId: string, mes: number, anio: number) {
    const startDate = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const endDate   = new Date(anio, mes, 0).toISOString().split('T')[0];

    const [totales] = await this.ds.query(`
      SELECT
        COALESCE(SUM(total) FILTER (WHERE estado != 'anulada'), 0) AS total_facturado,
        COALESCE(SUM(monto_pagado), 0) AS total_cobrado
      FROM facturas
      WHERE empresa_id = $1 AND fecha_emision BETWEEN $2 AND $3 AND deleted_at IS NULL
    `, [empresaId, startDate, endDate]);

    const porMetodoRaw = await this.ds.query(`
      SELECT metodo_pago, COALESCE(SUM(monto), 0) AS total
      FROM pagos
      WHERE empresa_id = $1
        AND fecha_pago BETWEEN $2 AND $3
        AND estado = 'verificado'
      GROUP BY metodo_pago ORDER BY total DESC
    `, [empresaId, startDate, endDate]);

    const topClientesRaw = await this.ds.query(`
      SELECT cl.nombre_completo AS nombre, COALESCE(SUM(p.monto), 0) AS monto
      FROM pagos p
      JOIN clientes cl ON cl.id = p.cliente_id
      WHERE p.empresa_id = $1
        AND p.fecha_pago BETWEEN $2 AND $3
        AND p.estado = 'verificado'
      GROUP BY cl.nombre_completo ORDER BY monto DESC LIMIT 10
    `, [empresaId, startDate, endDate]);

    const evolucionRaw = await this.ds.query(`
      SELECT
        p.fecha_pago::text AS fecha,
        COALESCE(SUM(p.monto), 0) AS cobrado,
        COUNT(DISTINCT p.factura_id) AS facturas
      FROM pagos p
      WHERE p.empresa_id = $1
        AND p.fecha_pago BETWEEN $2 AND $3
        AND p.estado = 'verificado'
      GROUP BY p.fecha_pago ORDER BY p.fecha_pago
    `, [empresaId, startDate, endDate]);

    const totalFacturado = Number(totales.total_facturado) || 0;
    const totalCobrado   = Number(totales.total_cobrado)   || 0;
    const totalPendiente = totalFacturado - totalCobrado;
    const tasaCobranza   = totalFacturado > 0
      ? Math.round((totalCobrado / totalFacturado) * 100)
      : 0;

    const porMetodo: Record<string, number> = {};
    porMetodoRaw.forEach((r: any) => { porMetodo[r.metodo_pago] = Number(r.total); });

    return {
      periodo:         `${mes}/${anio}`,
      totalFacturado,
      totalCobrado,
      totalPendiente,
      tasaCobranza,
      porMetodo,
      topClientes:     topClientesRaw.map((r: any) => ({ nombre: r.nombre, monto: Number(r.monto) })),
      evolucionDiaria: evolucionRaw.map((r: any) => ({
        fecha:    r.fecha,
        cobrado:  Number(r.cobrado),
        facturas: Number(r.facturas),
      })),
    };
  }

  // ── Reporte Clientes ──────────────────────────────────────
  async getClientes(empresaId: string, mes: number, anio: number) {
    const startDate = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const endDate   = new Date(anio, mes, 0).toISOString().split('T')[0];

    const [estados] = await this.ds.query(`
      SELECT
        COUNT(*) FILTER (WHERE estado = 'activo')              AS activos,
        COUNT(*) FILTER (WHERE estado = 'suspendido')          AS suspendidos,
        COUNT(*) FILTER (WHERE estado = 'baja_definitiva')     AS baja,
        COUNT(*) FILTER (WHERE estado = 'pendiente_instalacion') AS pendientes
      FROM clientes WHERE empresa_id = $1 AND deleted_at IS NULL
    `, [empresaId]);

    const [periodo] = await this.ds.query(`
      SELECT
        COUNT(*) FILTER (WHERE created_at BETWEEN $2 AND $3 || ' 23:59:59') AS nuevos,
        COUNT(*) FILTER (WHERE estado = 'baja_definitiva' AND updated_at BETWEEN $2 AND $3 || ' 23:59:59') AS bajas
      FROM clientes WHERE empresa_id = $1 AND deleted_at IS NULL
    `, [empresaId, startDate, endDate]);

    const porServicioRaw = await this.ds.query(`
      SELECT pl.nombre AS servicio, COUNT(*) AS total
      FROM contratos co
      JOIN planes pl ON pl.id = co.plan_id
      WHERE co.empresa_id = $1 AND co.estado = 'activo' AND co.deleted_at IS NULL
      GROUP BY pl.nombre ORDER BY total DESC
    `, [empresaId]);

    const porZonaRaw = await this.ds.query(`
      SELECT COALESCE(z.nombre, 'Sin zona') AS zona, COUNT(*) AS total
      FROM clientes cl
      LEFT JOIN zonas z ON z.id = cl.zona_id
      WHERE cl.empresa_id = $1 AND cl.deleted_at IS NULL
      GROUP BY z.nombre ORDER BY total DESC LIMIT 10
    `, [empresaId]);

    const totalActivos     = Number(estados.activos)     || 0;
    const totalSuspendidos = Number(estados.suspendidos) || 0;
    const totalBaja        = Number(estados.baja)        || 0;
    const nuevosMes        = Number(periodo.nuevos)      || 0;
    const bajasMes         = Number(periodo.bajas)       || 0;
    const totalBase        = totalActivos + totalSuspendidos;
    const churRate         = totalBase > 0 ? parseFloat(((bajasMes / totalBase) * 100).toFixed(2)) : 0;

    const porServicio: Record<string, number> = {};
    porServicioRaw.forEach((r: any) => { porServicio[r.servicio] = Number(r.total); });

    return {
      totalActivos,
      totalSuspendidos,
      totalBaja,
      nuevosMes,
      bajasMes,
      porServicio,
      porZona: porZonaRaw.map((r: any) => ({ zona: r.zona, total: Number(r.total) })),
      churRate,
    };
  }

  // ── Reporte Red ───────────────────────────────────────────
  async getRed(empresaId: string) {
    const [nodos] = await this.ds.query(`
      SELECT
        COUNT(*)                                          AS total,
        COUNT(*) FILTER (WHERE estado = 'online')         AS online,
        COUNT(*) FILTER (WHERE estado = 'offline')        AS offline,
        COUNT(*) FILTER (WHERE estado = 'degradado')      AS degradado,
        ROUND(AVG(latencia_ms) FILTER (WHERE latencia_ms IS NOT NULL)::numeric, 1) AS latencia_avg
      FROM nodos WHERE empresa_id = $1 AND activo = true
    `, [empresaId]);

    const [alertas] = await this.ds.query(`
      SELECT COUNT(*) FILTER (WHERE nivel = 'critical') AS criticas
      FROM alertas WHERE empresa_id = $1 AND estado = 'activa'
    `, [empresaId]);

    const topLatenciaRaw = await this.ds.query(`
      SELECT nombre, COALESCE(latencia_ms, 0) AS latencia_avg
      FROM nodos WHERE empresa_id = $1 AND activo = true
      ORDER BY latencia_ms DESC NULLS LAST LIMIT 5
    `, [empresaId]);

    const disponibilidadRaw = await this.ds.query(`
      SELECT
        DATE_TRUNC('day', created_at)::date::text AS fecha,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE estado = 'online') / NULLIF(COUNT(*), 0)
        ) AS pct
      FROM nodos_mediciones
      WHERE empresa_id = $1 AND created_at >= NOW() - INTERVAL '7 days'
      GROUP BY 1 ORDER BY 1
    `, [empresaId]).catch(() => []);

    const totalNodos   = Number(nodos.total)  || 0;
    const onlineCount  = Number(nodos.online) || 0;
    const uptimePromedio = totalNodos > 0 ? Math.round((onlineCount / totalNodos) * 100) : 0;

    return {
      totalNodos,
      uptimePromedio,
      alertasCriticas: Number(alertas.criticas) || 0,
      incidentes:      0,
      topNodosLatencia: topLatenciaRaw.map((r: any) => ({
        nombre:      r.nombre,
        latenciaAvg: Number(r.latencia_avg),
      })),
      disponibilidad: disponibilidadRaw.map((r: any) => ({
        fecha: r.fecha,
        pct:   Number(r.pct) || 0,
      })),
    };
  }

  // ── Exportar CSV ──────────────────────────────────────────
  async exportarCobranzaCsv(empresaId: string, mes: number, anio: number): Promise<string> {
    const startDate = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const endDate   = new Date(anio, mes, 0).toISOString().split('T')[0];

    const rows = await this.ds.query(`
      SELECT
        f.numero_completo AS "Comprobante",
        cl.nombre_completo AS "Cliente",
        cl.numero_documento AS "Documento",
        f.fecha_emision AS "Emisión",
        f.fecha_vencimiento AS "Vencimiento",
        CAST(f.total AS FLOAT) AS "Total",
        CAST(f.monto_pagado AS FLOAT) AS "Pagado",
        CAST(f.saldo AS FLOAT) AS "Saldo",
        f.estado AS "Estado"
      FROM facturas f
      JOIN clientes cl ON cl.id = f.cliente_id
      WHERE f.empresa_id = $1
        AND f.fecha_emision BETWEEN $2 AND $3
        AND f.deleted_at IS NULL
      ORDER BY f.fecha_emision, cl.nombre_completo
    `, [empresaId, startDate, endDate]);

    if (!rows.length) return 'Sin datos para el período seleccionado';

    const headers = Object.keys(rows[0]).join(',');
    const lines = rows.map((r: any) =>
      Object.values(r).map((v: any) =>
        typeof v === 'string' && v.includes(',') ? `"${v}"` : (v ?? '')
      ).join(',')
    );
    return [headers, ...lines].join('\n');
  }
}
