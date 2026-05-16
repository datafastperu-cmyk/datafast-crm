import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class DashboardService {
  constructor(private readonly dataSource: DataSource) {}

  async getStats(empresaId: string) {
    const [[clientes], [contratos], [pagos], [facturas], [nodos], [alertas]] =
      await Promise.all([
        this.dataSource.query(`
          SELECT
            COUNT(*)                                                   AS total,
            COUNT(*) FILTER (WHERE estado = 'activo')                  AS activos,
            COUNT(*) FILTER (WHERE estado = 'moroso')                  AS morosos,
            COUNT(*) FILTER (WHERE DATE(created_at AT TIME ZONE 'UTC') = CURRENT_DATE) AS nuevos_hoy
          FROM clientes WHERE empresa_id = $1
        `, [empresaId]),

        this.dataSource.query(`
          SELECT
            COUNT(*)                                                                        AS total,
            COUNT(*) FILTER (WHERE estado IN ('activo','prorroga'))                         AS activos,
            COUNT(*) FILTER (WHERE estado IN ('suspendido_mora','suspendido_manual'))        AS suspendidos,
            COUNT(*) FILTER (WHERE fecha_vencimiento BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
                             AND estado = 'activo')                                         AS por_vencer
          FROM contratos WHERE empresa_id = $1
        `, [empresaId]),

        this.dataSource.query(`
          SELECT
            COALESCE(SUM(monto) FILTER (WHERE fecha_pago = CURRENT_DATE AND estado = 'verificado'), 0)            AS cobrado_hoy,
            COALESCE(SUM(monto) FILTER (WHERE fecha_pago >= DATE_TRUNC('month', CURRENT_DATE) AND estado = 'verificado'), 0) AS cobrado_mes
          FROM pagos WHERE empresa_id = $1
        `, [empresaId]),

        this.dataSource.query(`
          SELECT COALESCE(SUM(total - monto_pagado), 0) AS cuentas_por_cobrar
          FROM facturas
          WHERE empresa_id = $1 AND estado IN ('emitida','vencida','pagada_parcial','en_cobranza')
        `, [empresaId]),

        this.dataSource.query(`
          SELECT
            COUNT(*)                                          AS total,
            COUNT(*) FILTER (WHERE estado = 'online')         AS online,
            COUNT(*) FILTER (WHERE estado = 'offline')        AS offline,
            COUNT(*) FILTER (WHERE estado = 'degradado')      AS degradado
          FROM nodos WHERE empresa_id = $1 AND activo = true
        `, [empresaId]),

        this.dataSource.query(`
          SELECT
            COUNT(*)                                              AS activas,
            COUNT(*) FILTER (WHERE nivel = 'critical')            AS criticas,
            COUNT(*) FILTER (WHERE nivel = 'warning')             AS warnings
          FROM alertas WHERE empresa_id = $1 AND estado = 'activa'
        `, [empresaId]),
      ]);

    const cobradoMes       = Number(pagos.cobrado_mes)          || 0;
    const cuentasPorCobrar = Number(facturas.cuentas_por_cobrar) || 0;
    const baseCobranza     = cobradoMes + cuentasPorCobrar;

    return {
      clientes: {
        total:     Number(clientes.total)      || 0,
        activos:   Number(clientes.activos)    || 0,
        morosos:   Number(clientes.morosos)    || 0,
        nuevosHoy: Number(clientes.nuevos_hoy) || 0,
      },
      contratos: {
        total:       Number(contratos.total)       || 0,
        activos:     Number(contratos.activos)     || 0,
        suspendidos: Number(contratos.suspendidos) || 0,
        porVencer:   Number(contratos.por_vencer)  || 0,
      },
      facturacion: {
        cobradoHoy:       Number(pagos.cobrado_hoy) || 0,
        cobradoMes,
        cuentasPorCobrar,
        tasaCobranza: baseCobranza > 0 ? Math.round((cobradoMes / baseCobranza) * 100) : 0,
      },
      nodos: {
        total:     Number(nodos.total)     || 0,
        online:    Number(nodos.online)    || 0,
        offline:   Number(nodos.offline)   || 0,
        degradado: Number(nodos.degradado) || 0,
      },
      alertas: {
        activas:  Number(alertas.activas)  || 0,
        criticas: Number(alertas.criticas) || 0,
        warnings: Number(alertas.warnings) || 0,
      },
    };
  }
}
