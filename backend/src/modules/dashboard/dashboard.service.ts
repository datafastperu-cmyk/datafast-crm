import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { sqlDeudaExigible } from '../facturacion/domain/estados-con-saldo';
import { sqlEnMora } from '../facturacion/domain/mora';

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
            COUNT(*) FILTER (WHERE estado = 'suspendido')              AS suspendidos,
            COUNT(*) FILTER (WHERE DATE(created_at AT TIME ZONE 'UTC') = CURRENT_DATE) AS nuevos_hoy
          FROM clientes WHERE empresa_id = $1
        `, [empresaId]),

        // `en_mora` NO es un estado del contrato: es la etiqueta derivada de las facturas
        // (`facturacion/domain/mora.ts`). Un abonado en mora sigue `activo` y con servicio
        // hasta que el corte por acumulación lo suspende, así que `activos` y `en_mora` se
        // solapan a propósito — son dos preguntas distintas, no dos casillas excluyentes.
        this.dataSource.query(`
          SELECT
            COUNT(*)                                                                        AS total,
            COUNT(*) FILTER (WHERE c.estado = 'activo')                                      AS activos,
            COUNT(*) FILTER (WHERE c.estado = 'suspendido')                                 AS suspendidos,
            COUNT(*) FILTER (WHERE c.estado = 'activo' AND ${sqlEnMora('c.cliente_id')})     AS en_mora,
            COUNT(*) FILTER (WHERE c.fecha_vencimiento BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
                             AND c.estado = 'activo')                                       AS por_vencer
          FROM servicios c WHERE c.empresa_id = $1
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
          WHERE empresa_id = $1 AND ${sqlDeudaExigible()}
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
        suspendidos: Number(clientes.suspendidos) || 0,
        nuevosHoy: Number(clientes.nuevos_hoy) || 0,
      },
      contratos: {
        total:       Number(contratos.total)       || 0,
        activos:     Number(contratos.activos)     || 0,
        suspendidos: Number(contratos.suspendidos) || 0,
        // Etiqueta derivada, no estado: se solapa con `activos` a propósito.
        enMora:      Number(contratos.en_mora)     || 0,
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
