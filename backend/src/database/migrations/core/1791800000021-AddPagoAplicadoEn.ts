import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `pagos.aplicado_en` — marca de que el pago llegó a surtir efecto (factura saldada y
 * contrato reevaluado), no solo de que quedó registrado.
 *
 * Hasta ahora la aplicación de un pago no era transaccional y su error se tragaba con un
 * log ("no fallar — el pago ya quedó registrado"). Si fallaba a mitad —timeout, restart de
 * PM2, un deploy— el abonado quedaba CORTADO con su pago cobrado, y ningún proceso lo
 * detectaba: el reconciliador compara ERP contra hardware, así que confirmaba que el corte
 * estaba bien aplicado. Se descubría cuando el cliente reclamaba.
 *
 * Con esta columna el fallo deja de ser invisible: un pago verificado con `aplicado_en`
 * NULL es trabajo pendiente que el watcher reintenta.
 *
 * Los pagos verificados que ya existen se marcan como aplicados: su efecto ya ocurrió (o
 * ya se corrigió a mano) y reprocesarlos podría reactivar contratos dados de baja después.
 */
export class AddPagoAplicadoEn1791800000021 implements MigrationInterface {
  name = 'AddPagoAplicadoEn1791800000021';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE pagos ADD COLUMN IF NOT EXISTS aplicado_en TIMESTAMPTZ
    `);
    await queryRunner.query(`
      UPDATE pagos SET aplicado_en = COALESCE(verificado_en, updated_at, created_at)
      WHERE estado = 'verificado' AND aplicado_en IS NULL
    `);
    // Índice parcial: el watcher solo pregunta por la cola de pendientes, que en régimen
    // normal está vacía. Sin el predicado, el barrido escanearía toda la tabla de pagos
    // cada pocos minutos — y esa tabla solo crece.
    //
    // `pagos` NO tiene `deleted_at`: los pagos no se borran, se anulan por estado. Darlo
    // por hecho por costumbre hizo fallar la primera versión de esta migración.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_pagos_sin_aplicar
      ON pagos (verificado_en)
      WHERE estado = 'verificado' AND aplicado_en IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_pagos_sin_aplicar`);
    await queryRunner.query(`ALTER TABLE pagos DROP COLUMN IF EXISTS aplicado_en`);
  }
}
