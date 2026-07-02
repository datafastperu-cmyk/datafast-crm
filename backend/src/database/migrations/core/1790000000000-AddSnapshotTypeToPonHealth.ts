import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────
// Fase: PON Port Health — discriminador snapshot_type
//
// Extiende olt_health_snapshots para soportar tres tipos de fila:
//   'board'    → slot-level  (port IS NULL)     — ya existía
//   'pom'      → transceiver (port IS NOT NULL)  — ya existía
//   'pon_port' → estado PON por puerto (nuevo)
//
// La columna snapshot_type permite DISTINCT ON (slot, port, snapshot_type)
// sin mezclar POM con estado operativo del puerto.
//
// Requiere: 1789900000000-AddOltHealthAlertasAndFirmware
// ─────────────────────────────────────────────────────────────
export class AddSnapshotTypeToPonHealth1790000000000 implements MigrationInterface {
  name = 'AddSnapshotTypeToPonHealth1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {

    // ── 1. Columna discriminadora ─────────────────────────────
    await queryRunner.query(`
      ALTER TABLE olt_health_snapshots
        ADD COLUMN IF NOT EXISTS snapshot_type VARCHAR(20) NOT NULL DEFAULT 'board'
    `);

    // ── 2. Retrocompatibilidad: tipificar filas existentes ────
    await queryRunner.query(`
      UPDATE olt_health_snapshots
        SET snapshot_type = 'pom'
       WHERE port IS NOT NULL AND snapshot_type = 'board'
    `);

    // ── 3. Columnas de estado PON por puerto ──────────────────
    await queryRunner.query(`
      ALTER TABLE olt_health_snapshots
        ADD COLUMN IF NOT EXISTS port_type    VARCHAR(10),
        ADD COLUMN IF NOT EXISTS admin_state  VARCHAR(30),
        ADD COLUMN IF NOT EXISTS oper_state   VARCHAR(30),
        ADD COLUMN IF NOT EXISTS autofind     VARCHAR(20)
    `);

    // ── 4. Índice especializado para query pon_port ───────────
    // DISTINCT ON (slot, port) ORDER BY captured_at DESC — muy frecuente
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_health_pon_port
        ON olt_health_snapshots (olt_id, slot, port, snapshot_type, captured_at DESC)
        WHERE snapshot_type = 'pon_port'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN olt_health_snapshots.snapshot_type
        IS 'board | pom | pon_port — discrimina el tipo de dato en la fila';
      COMMENT ON COLUMN olt_health_snapshots.port_type
        IS 'GPON | EPON | XGS-PON — tipo de tecnología del puerto';
      COMMENT ON COLUMN olt_health_snapshots.admin_state
        IS 'enabled | disabled — estado administrativo del puerto PON';
      COMMENT ON COLUMN olt_health_snapshots.oper_state
        IS 'up | down — estado operativo del puerto PON';
      COMMENT ON COLUMN olt_health_snapshots.autofind
        IS 'autofind | manual — modo de detección de ONUs en el puerto';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_health_pon_port`);
    await queryRunner.query(`
      ALTER TABLE olt_health_snapshots
        DROP COLUMN IF EXISTS autofind,
        DROP COLUMN IF EXISTS oper_state,
        DROP COLUMN IF EXISTS admin_state,
        DROP COLUMN IF EXISTS port_type,
        DROP COLUMN IF EXISTS snapshot_type
    `);
  }
}
