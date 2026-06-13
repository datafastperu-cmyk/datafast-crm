import { MigrationInterface, QueryRunner } from 'typeorm';

// Convierte los UNIQUE constraints globales restantes (sin filtro deleted_at IS NULL)
// en índices únicos parciales para instalaciones existentes.
// Las migraciones fuente ya fueron corregidas para nuevas instalaciones.
// Patrón: DROP CONSTRAINT IF EXISTS → CREATE UNIQUE INDEX IF NOT EXISTS WHERE deleted_at IS NULL.
export class FixRemainingUniqueConstraints1785000000000 implements MigrationInterface {
  name = 'FixRemainingUniqueConstraints1785000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── roles: UNIQUE (empresa_id, nombre) ──────────────────────────────────────
    await queryRunner.query(`ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_empresa_id_nombre_key`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_empresa_nombre
        ON roles (empresa_id, nombre)
        WHERE deleted_at IS NULL
    `);

    // ── usuarios: UNIQUE (empresa_id, email) ────────────────────────────────────
    await queryRunner.query(`ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_empresa_id_email_key`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_empresa_email
        ON usuarios (empresa_id, email)
        WHERE deleted_at IS NULL
    `);

    // ── onus: UNIQUE (empresa_id, serial_number) ────────────────────────────────
    await queryRunner.query(`ALTER TABLE onus DROP CONSTRAINT IF EXISTS onus_empresa_id_serial_number_key`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_onus_empresa_serial
        ON onus (empresa_id, serial_number)
        WHERE deleted_at IS NULL
    `);

    // ── onus: UNIQUE (olt_id, pon_port, onu_id) ─────────────────────────────────
    await queryRunner.query(`ALTER TABLE onus DROP CONSTRAINT IF EXISTS onus_olt_id_pon_port_onu_id_key`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_onus_olt_pon_id
        ON onus (olt_id, pon_port, onu_id)
        WHERE deleted_at IS NULL AND onu_id IS NOT NULL
    `);

    // ── contratos: UNIQUE (empresa_id, numero_contrato) ──────────────────────────
    await queryRunner.query(`ALTER TABLE contratos DROP CONSTRAINT IF EXISTS contratos_empresa_id_numero_contrato_key`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_contratos_empresa_numero
        ON contratos (empresa_id, numero_contrato)
        WHERE deleted_at IS NULL
    `);

    // ── contratos: UNIQUE (empresa_id, onu_id) ───────────────────────────────────
    await queryRunner.query(`ALTER TABLE contratos DROP CONSTRAINT IF EXISTS contratos_empresa_id_onu_id_key`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_contratos_empresa_onu
        ON contratos (empresa_id, onu_id)
        WHERE deleted_at IS NULL AND onu_id IS NOT NULL
    `);

    // ── tickets: UNIQUE (empresa_id, numero_ticket) ──────────────────────────────
    await queryRunner.query(`ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_empresa_id_numero_ticket_key`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_tickets_empresa_numero
        ON tickets (empresa_id, numero_ticket)
        WHERE deleted_at IS NULL
    `);

    // ── ordenes_trabajo: UNIQUE (empresa_id, numero_orden) ───────────────────────
    await queryRunner.query(`ALTER TABLE ordenes_trabajo DROP CONSTRAINT IF EXISTS ordenes_trabajo_empresa_id_numero_orden_key`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_ordenes_empresa_numero
        ON ordenes_trabajo (empresa_id, numero_orden)
        WHERE deleted_at IS NULL
    `);

    // ── plantillas_mensajes: UNIQUE (empresa_id, tipo, codigo) ───────────────────
    await queryRunner.query(`ALTER TABLE plantillas_mensajes DROP CONSTRAINT IF EXISTS uq_plantilla_empresa_tipo_codigo`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_plantillas_empresa_tipo_codigo
        ON plantillas_mensajes (empresa_id, tipo, codigo)
        WHERE deleted_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_plantillas_empresa_tipo_codigo`);
    await queryRunner.query(`ALTER TABLE plantillas_mensajes ADD CONSTRAINT uq_plantilla_empresa_tipo_codigo UNIQUE (empresa_id, tipo, codigo)`);

    await queryRunner.query(`DROP INDEX IF EXISTS uq_ordenes_empresa_numero`);
    await queryRunner.query(`ALTER TABLE ordenes_trabajo ADD CONSTRAINT ordenes_trabajo_empresa_id_numero_orden_key UNIQUE (empresa_id, numero_orden)`);

    await queryRunner.query(`DROP INDEX IF EXISTS uq_tickets_empresa_numero`);
    await queryRunner.query(`ALTER TABLE tickets ADD CONSTRAINT tickets_empresa_id_numero_ticket_key UNIQUE (empresa_id, numero_ticket)`);

    await queryRunner.query(`DROP INDEX IF EXISTS uq_contratos_empresa_onu`);
    await queryRunner.query(`ALTER TABLE contratos ADD CONSTRAINT contratos_empresa_id_onu_id_key UNIQUE (empresa_id, onu_id)`);

    await queryRunner.query(`DROP INDEX IF EXISTS uq_contratos_empresa_numero`);
    await queryRunner.query(`ALTER TABLE contratos ADD CONSTRAINT contratos_empresa_id_numero_contrato_key UNIQUE (empresa_id, numero_contrato)`);

    await queryRunner.query(`DROP INDEX IF EXISTS uq_onus_olt_pon_id`);
    await queryRunner.query(`ALTER TABLE onus ADD CONSTRAINT onus_olt_id_pon_port_onu_id_key UNIQUE (olt_id, pon_port, onu_id)`);

    await queryRunner.query(`DROP INDEX IF EXISTS uq_onus_empresa_serial`);
    await queryRunner.query(`ALTER TABLE onus ADD CONSTRAINT onus_empresa_id_serial_number_key UNIQUE (empresa_id, serial_number)`);

    await queryRunner.query(`DROP INDEX IF EXISTS uq_usuarios_empresa_email`);
    await queryRunner.query(`ALTER TABLE usuarios ADD CONSTRAINT usuarios_empresa_id_email_key UNIQUE (empresa_id, email)`);

    await queryRunner.query(`DROP INDEX IF EXISTS uq_roles_empresa_nombre`);
    await queryRunner.query(`ALTER TABLE roles ADD CONSTRAINT roles_empresa_id_nombre_key UNIQUE (empresa_id, nombre)`);
  }
}
