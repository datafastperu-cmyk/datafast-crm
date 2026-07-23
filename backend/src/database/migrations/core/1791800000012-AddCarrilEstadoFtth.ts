import { MigrationInterface, QueryRunner } from 'typeorm';

// Fase 0 del carril TR-069 bajo demanda: máquina de estados del carril + marca de último uso
// del operador, poblados desde el flag histórico `tr069_bootstrap_aplicado`. Aditiva y sin
// cambio de comportamiento — nada lee `carril_estado` todavía (eso empieza en Fase 2).
//
// CREATE TYPE de un enum NUEVO sí puede ir en transacción (a diferencia de ALTER TYPE ADD
// VALUE). Solo aplica al proveedor NATIVO; SmartOLT/AdminOLT no usan ftth_onu_registro.
export class AddCarrilEstadoFtth1791800000012 implements MigrationInterface {
  name = 'AddCarrilEstadoFtth1791800000012';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ftth_carril_estado') THEN
          CREATE TYPE ftth_carril_estado AS ENUM (
            'inactivo', 'activando', 'activo', 'activacion_fallida',
            'desactivando', 'inactivo_reservado', 'desactivacion_fallida'
          );
        END IF;
      END $$;
    `);

    await qr.query(`
      ALTER TABLE ftth_onu_registro
        ADD COLUMN IF NOT EXISTS carril_estado ftth_carril_estado NOT NULL DEFAULT 'inactivo',
        ADD COLUMN IF NOT EXISTS tr069_ultimo_uso_at timestamptz NULL
    `);

    // Backfill: lo que hoy tiene el flag en true es un carril activo; el resto, inactivo.
    await qr.query(`
      UPDATE ftth_onu_registro
      SET carril_estado = CASE WHEN tr069_bootstrap_aplicado THEN 'activo'::ftth_carril_estado
                               ELSE 'inactivo'::ftth_carril_estado END
    `);

    // Consulta caliente de los watchers y del barrido: "carriles por estado".
    await qr.query(
      `CREATE INDEX IF NOT EXISTS idx_ftth_carril_estado ON ftth_onu_registro (carril_estado)`,
    );
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_ftth_carril_estado`);
    await qr.query(`ALTER TABLE ftth_onu_registro DROP COLUMN IF EXISTS tr069_ultimo_uso_at`);
    await qr.query(`ALTER TABLE ftth_onu_registro DROP COLUMN IF EXISTS carril_estado`);
    await qr.query(`DROP TYPE IF EXISTS ftth_carril_estado`);
  }
}
