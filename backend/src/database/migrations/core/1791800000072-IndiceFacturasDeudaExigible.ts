import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Índice parcial que sostiene "¿este contrato debe algo?" contra `facturas`, sin depender de
 * ningún acumulador (Ola 4, entregable 3-4).
 *
 * `facturas.saldo` es `GENERATED ALWAYS AS (total - monto_pagado) STORED` — la fuente de
 * verdad ya existe y es inviolable (ADR-019). Lo que faltaba era que preguntarle "¿hay algo sin
 * pagar?" a 10.000+ contratos en un barrido (el corte nocturno, un resumen de dashboard, un
 * listado filtrado) fuera tan barato como leer una columna. Medido en CI antes de crear esto
 * (censo `E-0.2-censo-calculo-deuda.md` §11.5, `scripts/medir-deuda-por-facturas.sql`,
 * repetible): 30.295 ms sobre 120.000 facturas / 10.000 contratos, en caliente, con el
 * predicado de este índice — sostiene la pregunta sin acumulador.
 *
 * El predicado replica `sqlDeudaExigible()` (`facturacion/domain/estados-con-saldo.ts`) a
 * propósito, no por descuido: un índice parcial solo lo usa el planificador si puede probar
 * que el `WHERE` de la consulta implica el predicado del índice. Si este texto diverge de
 * `sqlDeudaExigible()`, el índice deja de aplicarse en silencio — vuelve a un *seq scan*, sin
 * que nada avise. La nota de `NotaCreditoNoEsDeuda` (1791800000049) explica por qué una
 * definición vive en SQL literal aparte de la constante de TypeScript: una vista o un índice de
 * BD no pueden depender de una constante de otro lenguaje. Aquí aplica el mismo motivo.
 *
 * NO incluye `fecha_vencimiento < CURRENT_DATE` (lo que distingue "exigible" de "vencido"):
 * `CURRENT_DATE` no es inmutable, un índice parcial lo rechaza. La distinción vencido/exigible
 * la sigue resolviendo la consulta que lo use, igual que hoy.
 */
export class IndiceFacturasDeudaExigible1791800000072 implements MigrationInterface {
  name = 'IndiceFacturasDeudaExigible1791800000072';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE INDEX idx_facturas_contrato_exigible ON facturas (contrato_id)
        WHERE estado IN ('emitida', 'pagada_parcial', 'vencida', 'en_cobranza')
          AND factura_original_id IS NULL
    `);

    await qr.query(`
      COMMENT ON INDEX idx_facturas_contrato_exigible IS
        'Sostiene "este contrato tiene deuda exigible" sin acumulador (Ola 4, censo de deuda). '
        'El predicado replica sqlDeudaExigible() a propósito -- si diverge, el planificador deja '
        'de poder usar el índice, sin aviso.'
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_facturas_contrato_exigible`);
  }
}
