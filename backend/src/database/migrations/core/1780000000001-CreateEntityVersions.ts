import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEntityVersions1780000000001 implements MigrationInterface {
  name = 'CreateEntityVersions1780000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS entity_versions (
        id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id          UUID,
        usuario_id          UUID,
        usuario_email       VARCHAR(200),
        modulo              VARCHAR(50)   NOT NULL,
        tabla               VARCHAR(100)  NOT NULL,
        entidad_id          VARCHAR(100)  NOT NULL,
        accion              VARCHAR(20)   NOT NULL,
        snapshot_anterior   JSONB,
        snapshot_posterior  JSONB,
        redo_snapshot       JSONB,
        descripcion         VARCHAR(500),
        reversible          BOOLEAN       NOT NULL DEFAULT true,
        revertido           BOOLEAN       NOT NULL DEFAULT false,
        revertido_en        TIMESTAMPTZ,
        created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_ev_usuario_undo
        ON entity_versions (usuario_id, empresa_id, revertido, created_at DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_ev_entidad
        ON entity_versions (tabla, entidad_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_ev_empresa_fecha
        ON entity_versions (empresa_id, created_at DESC)
    `);

    // Índices en auditoria_logs si no existen
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_empresa_fecha
        ON auditoria_logs (empresa_id, created_at DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_usuario
        ON auditoria_logs (usuario_id, created_at DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_modulo
        ON auditoria_logs (empresa_id, modulo, created_at DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_audit_logs_modulo`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_audit_logs_usuario`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_audit_logs_empresa_fecha`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_ev_empresa_fecha`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_ev_entidad`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_ev_usuario_undo`);
    await queryRunner.query(`DROP TABLE IF EXISTS entity_versions`);
  }
}
