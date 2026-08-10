import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cola suelta del anclaje 1-31 (decisión 29-ter, 2026-08-09).
 *
 * Cuando el día de pago pasó de admitir 1-28 a admitir **1-31 con recorte a fin de mes**, se
 * cambió `PoliticaFacturacionService` pero nadie barrió las restricciones que lo alimentan.
 * `servicios.dia_facturacion` es el **respaldo** del día de pago —lo usa `resolver()` cuando el
 * abonado no tiene configuración propia— y seguía topado en 28 por un `CHECK` de la migración
 * original.
 *
 * Resultado: el modelo sabe manejar un abonado anclado en 31 —vence el 28 de febrero y vuelve al
 * 31 en marzo— pero no se le podía escribir ese 31 en el campo que se lo iba a dar. La mitad de
 * una decisión.
 *
 * El motivo por el que existía el tope era justamente el que la decisión descartó: se eligió 28
 * «para evitar el problema de febrero», que es razonar desde el estado en vez de desde la forma
 * del sector. El recorte a fin de mes ya lo resuelve.
 */
export class DiaDeRespaldoHasta31791800000057 implements MigrationInterface {
  name = 'DiaDeRespaldoHasta31791800000057';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE servicios DROP CONSTRAINT IF EXISTS contratos_dia_facturacion_check`);
    await q.query(`
      ALTER TABLE servicios
        ADD CONSTRAINT servicios_dia_facturacion_check
        CHECK (dia_facturacion IS NULL OR (dia_facturacion >= 1 AND dia_facturacion <= 31))
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    // No se restaura el tope en 28: si algún servicio quedara anclado en 29-31, volver a
    // exigirlo haría fallar la reversión con datos legítimos dentro.
    await q.query(`ALTER TABLE servicios DROP CONSTRAINT IF EXISTS servicios_dia_facturacion_check`);
  }
}
