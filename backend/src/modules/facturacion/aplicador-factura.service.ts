import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

import { filasUpdateReturning } from '../../common/utils/pg-result.util';

/**
 * EL ÚNICO SITIO donde el dinero entra en un comprobante.
 *
 * Existe como pieza propia por dos razones, y las dos importan:
 *
 * 1. **Era una regla sin mecanismo.** Había CUATRO copias del mismo UPDATE —el aplicador
 *    de facturación, el de `registrar()`, el de `adelantos` y el de `eliminar()`— y no
 *    divergieron de golpe: divergieron en la corrección que solo se aplicó a una. La de
 *    `adelantos` había perdido el guard `estado NOT IN ('pagada','anulada')`, así que
 *    consumía el saldo a favor del abonado contra un comprobante ANULADO.
 *
 * 2. **Vivía donde medio sistema no puede importarlo.** El saldo a favor lo consume tanto
 *    pagos como facturación, y `AdelantosModule` está fuera de los dos justamente para no
 *    crear el ciclo pagos ↔ facturación. Si la frontera es una regla del sistema, tiene
 *    que ser una pieza que cualquiera pueda usar sin arrastrar medio grafo de módulos.
 *
 * Depende solo de la conexión a base de datos. A propósito: nada de auditoría, colas ni
 * PDFs — los efectos de cada camino son suyos, el movimiento del saldo es de aquí.
 */
@Injectable()
export class AplicadorFacturaService {
  private readonly logger = new Logger(AplicadorFacturaService.name);

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /**
   * Vuelca `monto` sobre el comprobante y devuelve su estado resultante.
   *
   * @param manager  Transacción del llamante. Pasarlo es lo que permite que el volcado y
   *                 lo que el llamante haga con él (marcar la imputación, registrar el
   *                 pago) se confirmen o se deshagan JUNTOS.
   */
  async aplicar(
    facturaId: string,
    monto:     number,
    empresaId: string,
    fechaPago: string,
    manager?:  EntityManager,
  ): Promise<{ estado: string }> {
    const ejecutar = manager
      ? (sql: string, params: unknown[]) => manager.query(sql, params)
      : (sql: string, params: unknown[]) => this.ds.query(sql, params);

    // UPDATE condicional atómico: elimina la race de leer-calcular-escribir. El WHERE
    // valida el estado y que el importe no exceda el saldo pendiente, con tolerancia de
    // un céntimo para el redondeo. Dos cajeros cobrando la misma factura a la vez: el
    // segundo recibe un rechazo con el saldo real, no un sobrepago silencioso.
    const result = filasUpdateReturning<{ id: string; estado: string }>(await ejecutar(`
      UPDATE facturas
      SET
        monto_pagado = monto_pagado::numeric + $3::numeric,
        estado = CASE
          WHEN monto_pagado::numeric + $3::numeric >= total::numeric THEN 'pagada'::estado_factura
          ELSE 'pagada_parcial'::estado_factura
        END,
        fecha_pago = CASE
          WHEN monto_pagado::numeric + $3::numeric >= total::numeric THEN $4
          ELSE fecha_pago
        END
      WHERE id = $1 AND empresa_id = $2 AND deleted_at IS NULL
        AND estado NOT IN ('pagada', 'anulada')
        AND $3::numeric <= (total::numeric - monto_pagado::numeric + 0.01)
      RETURNING id, estado
    `, [facturaId, empresaId, monto, fechaPago]));

    if (!result.length) {
      // El rechazo se explica leyendo el estado REAL por el mismo manager: dentro de una
      // transacción ajena, leer por fuera devolvería la fila previa y el mensaje diría
      // una cosa distinta de la que acaba de pasar.
      const leer = manager ?? this.ds.manager;
      const [f] = await leer.query(
        `SELECT estado, total::numeric AS total, monto_pagado::numeric AS pagado
           FROM facturas WHERE id = $1 AND empresa_id = $2 AND deleted_at IS NULL`,
        [facturaId, empresaId],
      );
      if (!f) throw new BadRequestException('La factura no existe');
      if (f.estado === 'anulada') {
        throw new BadRequestException('No se puede aplicar un pago a una factura anulada');
      }
      if (f.estado === 'pagada') {
        throw new BadRequestException('La factura ya está completamente pagada');
      }
      const saldo = Number(f.total) - Number(f.pagado);
      throw new BadRequestException(
        `El monto S/ ${monto.toFixed(2)} excede el saldo pendiente S/ ${saldo.toFixed(2)}`,
      );
    }

    return { estado: result[0].estado };
  }

  /**
   * Invariante de contabilidad: el saldo cobrado de un comprobante es exactamente la suma
   * de lo que los pagos le imputaron.
   *
   * Es lo que hace que la frontera sea comprobable y no una intención. Cualquier
   * divergencia posterior a la fecha de corte significa que hay un escritor de dinero
   * fuera de este servicio, y lo dice el mismo día en vez de aparecer en un cierre.
   */
  async divergencias(limite = 25): Promise<Array<{
    id: string; numero: string | null; monto_pagado: string; aplicado: string;
  }>> {
    return this.ds.query(`
      WITH corte AS (SELECT COALESCE(MIN(created_at), NOW()) c FROM pago_aplicaciones)
      SELECT f.id, f.numero_completo AS numero,
             f.monto_pagado::text AS monto_pagado,
             COALESCE(SUM(pa.monto_aplicado), 0)::text AS aplicado
        FROM facturas f
        LEFT JOIN pago_aplicaciones pa ON pa.factura_id = f.id
       CROSS JOIN corte
       WHERE f.deleted_at IS NULL
         AND f.created_at >= corte.c
       GROUP BY f.id, corte.c
      HAVING ABS(f.monto_pagado::numeric - COALESCE(SUM(pa.monto_aplicado), 0)::numeric) > 0.01
       ORDER BY f.created_at DESC
       LIMIT $1
    `, [limite]);
  }
}
