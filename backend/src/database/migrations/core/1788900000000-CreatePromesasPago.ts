import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePromesasPago1788900000000 implements MigrationInterface {
  name = 'CreatePromesasPago1788900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS promesas_pago (
        id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id              UUID          NOT NULL,
        contrato_id             UUID          NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
        cliente_id              UUID          NOT NULL,

        estado                  VARCHAR(25)   NOT NULL DEFAULT 'activa',
        fecha_vencimiento       DATE          NOT NULL,
        monto_prometido         DECIMAL(10,2) NOT NULL DEFAULT 0,
        deuda_al_crear          DECIMAL(10,2) NOT NULL DEFAULT 0,

        ip_cliente_snapshot     INET,
        router_id_snapshot      UUID,
        usuario_pppoe_snapshot  VARCHAR(100),
        contrato_estado_previo  VARCHAR(30),

        motivo                  TEXT,
        otorgada_por            UUID,
        resuelta_por            UUID,
        resuelta_en             TIMESTAMPTZ,
        pago_id_cumplimiento    UUID,

        mikrotik_aplicado       BOOLEAN       NOT NULL DEFAULT FALSE,
        mikrotik_aplicado_en    TIMESTAMPTZ,
        mikrotik_reintentos     SMALLINT      NOT NULL DEFAULT 0,
        mikrotik_ultimo_error   TEXT,

        created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        created_by              UUID
      )
    `);

    /* Trigger updated_at automático */
    await queryRunner.query(`
      CREATE TRIGGER set_updated_at_promesas_pago
        BEFORE UPDATE ON promesas_pago
        FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at()
    `);

    /* Índice para el cron de expiración */
    await queryRunner.query(`
      CREATE INDEX idx_promesas_activas_vencimiento
        ON promesas_pago (fecha_vencimiento)
        WHERE estado = 'activa'
    `);

    /* Índice para listar por empresa + estado */
    await queryRunner.query(`
      CREATE INDEX idx_promesas_empresa_estado
        ON promesas_pago (empresa_id, estado)
    `);

    /* Nunca dos promesas activas para el mismo contrato */
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_promesas_una_activa_por_contrato
        ON promesas_pago (contrato_id)
        WHERE estado = 'activa'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS promesas_pago`);
  }
}
