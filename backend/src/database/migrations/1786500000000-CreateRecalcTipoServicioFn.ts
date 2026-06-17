import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRecalcTipoServicioFn1786500000000 implements MigrationInterface {
  name = 'CreateRecalcTipoServicioFn1786500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Función centralizada que recalcula tipo_servicio en clientes
    // basándose en sus contratos activos. Reemplaza los UPDATE hardcodeados
    // del orquestador de aprovisionamiento.
    //
    // Lógica:
    //   - tiene contratos WISP + FTTH activos → 'mixto'
    //   - solo FTTH activos → 'ftth'
    //   - cualquier otro caso → 'wisp'
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION recalc_tipo_servicio_cliente(p_cliente_id UUID)
      RETURNS void
      LANGUAGE sql
      AS $$
        UPDATE clientes
          SET tipo_servicio = (
            SELECT
              CASE
                WHEN COUNT(DISTINCT co.tipo_servicio) > 1         THEN 'mixto'
                WHEN MAX(co.tipo_servicio::text) = 'ftth'         THEN 'ftth'
                ELSE                                                   'wisp'
              END
            FROM contratos co
            WHERE co.cliente_id  = p_cliente_id
              AND co.deleted_at  IS NULL
              AND co.estado      != 'baja_definitiva'
          )
        WHERE id = p_cliente_id;
      $$;
    `);

    // Recalcular todos los clientes existentes para dejar la BD consistente
    await queryRunner.query(`
      SELECT recalc_tipo_servicio_cliente(id) FROM clientes WHERE deleted_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION IF EXISTS recalc_tipo_servicio_cliente(UUID)`);
  }
}
