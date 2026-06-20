import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega columnas de verify-after-write a la tabla contratos:
 *   hardware_verificado    — true si la última verificación confirmó la config en hardware
 *   hardware_verificado_en — timestamp de la última verificación
 *   hardware_estado        — 'ok' | 'inconsistente' | 'desconocido' | 'sin_hardware'
 *
 * El reconciliador usa estas columnas para priorizar qué contratos verificar primero:
 *   hardware_verificado = false  OR
 *   hardware_verificado_en < NOW() - INTERVAL '30 min'
 */
export class AddHardwareVerificadoToContratos1788200000000 implements MigrationInterface {
  name = 'AddHardwareVerificadoToContratos1788200000000';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE contratos ADD COLUMN IF NOT EXISTS hardware_verificado    BOOLEAN     NOT NULL DEFAULT false`);
    await qr.query(`ALTER TABLE contratos ADD COLUMN IF NOT EXISTS hardware_verificado_en TIMESTAMPTZ`);
    await qr.query(`ALTER TABLE contratos ADD COLUMN IF NOT EXISTS hardware_estado        VARCHAR(30) NOT NULL DEFAULT 'desconocido'`);

    // Índice para el reconciliador: contratos activos/suspendidos pendientes de verificación
    await qr.query(`
      CREATE INDEX idx_contratos_hw_verify
        ON contratos (empresa_id, hardware_verificado_en NULLS FIRST)
        WHERE estado IN ('activo', 'suspendido', 'moroso', 'cortado')
          AND deleted_at IS NULL
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_contratos_hw_verify`);
    await qr.query(`ALTER TABLE contratos DROP COLUMN IF EXISTS hardware_verificado`);
    await qr.query(`ALTER TABLE contratos DROP COLUMN IF EXISTS hardware_verificado_en`);
    await qr.query(`ALTER TABLE contratos DROP COLUMN IF EXISTS hardware_estado`);
  }
}
