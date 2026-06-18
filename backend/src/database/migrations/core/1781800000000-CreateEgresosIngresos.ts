import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEgresosIngresos1781800000000 implements MigrationInterface {
  name = 'CreateEgresosIngresos1781800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {

    await queryRunner.query(`
      CREATE TYPE tipo_movimiento_opex AS ENUM (
        'INGRESO_OTRO',
        'EGRESO'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE categoria_movimiento_opex AS ENUM (
        'SERVICIOS_LUZ_AGUA',
        'INTERNET_PROVEEDOR',
        'PLANILLA_EMPLEADOS',
        'ALQUILERES',
        'OTROS'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE estado_movimiento_opex AS ENUM (
        'PAGADO',
        'PENDIENTE_PAGO'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE egresos_ingresos (
        id              UUID                        PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id      UUID                        NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        tipo            tipo_movimiento_opex         NOT NULL,
        categoria       categoria_movimiento_opex    NOT NULL DEFAULT 'OTROS',
        monto           DECIMAL(12, 2)               NOT NULL,
        fecha_registro  DATE                         NOT NULL,
        descripcion     TEXT,
        es_recurrente   BOOLEAN                      NOT NULL DEFAULT FALSE,
        dia_vencimiento SMALLINT                     CHECK (dia_vencimiento BETWEEN 1 AND 31),
        estado          estado_movimiento_opex        NOT NULL DEFAULT 'PAGADO',
        plantilla_id    UUID                         REFERENCES egresos_ingresos(id) ON DELETE SET NULL,
        created_at      TIMESTAMPTZ                  NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ                  NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_egresos_ingresos_empresa_fecha
        ON egresos_ingresos (empresa_id, fecha_registro)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_egresos_ingresos_recurrentes
        ON egresos_ingresos (empresa_id, es_recurrente, dia_vencimiento)
        WHERE es_recurrente = TRUE
    `);

    await queryRunner.query(`
      CREATE INDEX idx_egresos_ingresos_pendientes
        ON egresos_ingresos (empresa_id, estado)
        WHERE estado = 'PENDIENTE_PAGO'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS egresos_ingresos`);
    await queryRunner.query(`DROP TYPE IF EXISTS estado_movimiento_opex`);
    await queryRunner.query(`DROP TYPE IF EXISTS categoria_movimiento_opex`);
    await queryRunner.query(`DROP TYPE IF EXISTS tipo_movimiento_opex`);
  }
}
