import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Paso 1 del sistema de aprovisionamiento FTTH nativo.
 *
 * Crea la tabla ftth_onu_registro con máquina de estados para el
 * aprovisionamiento atómico en dos fases (GPON + WAN OMCI).
 *
 * También hace nullable tipo_servicio en clientes: ese campo pasa a ser
 * derivado de los contratos activos del abonado, no editable directamente.
 */
export class CreateFtthOnuRegistro1789400000000 implements MigrationInterface {
  name = 'CreateFtthOnuRegistro1789400000000';

  public async up(qr: QueryRunner): Promise<void> {

    // ── 1. Enum de estados de la máquina de aprovisionamiento ──
    await qr.query(`
      CREATE TYPE ftth_onu_estado AS ENUM (
        'pendiente',
        'gpon_registrado',
        'wan_inyectado',
        'activo',
        'fallido_gpon',
        'fallido_wan',
        'desaprovisionando'
      )
    `);

    // ── 2. Tabla principal ─────────────────────────────────────
    await qr.query(`
      CREATE TABLE ftth_onu_registro (
        id               UUID         NOT NULL DEFAULT gen_random_uuid(),
        empresa_id       UUID         NOT NULL,
        contrato_id      UUID         NOT NULL,
        olt_id           UUID         NOT NULL,

        -- Posición física en la OLT
        frame            SMALLINT     NOT NULL DEFAULT 0,
        slot             SMALLINT     NOT NULL,
        port             SMALLINT     NOT NULL,
        onu_id           SMALLINT     NOT NULL,
        sn               VARCHAR(16)  NOT NULL,
        service_port_id  INTEGER      NULL,
        vlan             SMALLINT     NOT NULL,
        lineprofile_id   INTEGER      NULL,
        srvprofile_id    INTEGER      NULL,

        -- Máquina de estados
        estado           ftth_onu_estado NOT NULL DEFAULT 'pendiente',
        locked_at        TIMESTAMPTZ  NULL,
        intentos_gpon    SMALLINT     NOT NULL DEFAULT 0,
        intentos_wan     SMALLINT     NOT NULL DEFAULT 0,
        ultimo_error     TEXT         NULL,

        -- BaseModel
        created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        deleted_at       TIMESTAMPTZ  NULL,
        version          INTEGER      NOT NULL DEFAULT 1,

        CONSTRAINT pk_ftth_onu_registro   PRIMARY KEY (id),
        CONSTRAINT uq_ftth_contrato_id    UNIQUE (contrato_id)
      )
    `);

    // ── 3. Índices ─────────────────────────────────────────────
    // SN único entre registros NO fallidos/desaprovisionados
    await qr.query(`
      CREATE UNIQUE INDEX uq_ftth_sn_activo
        ON ftth_onu_registro (sn)
        WHERE estado NOT IN ('fallido_gpon', 'desaprovisionando')
          AND deleted_at IS NULL
    `);

    await qr.query(`CREATE INDEX idx_ftth_empresa ON ftth_onu_registro (empresa_id)`);
    await qr.query(`CREATE INDEX idx_ftth_olt     ON ftth_onu_registro (olt_id)`);
    await qr.query(`CREATE INDEX idx_ftth_estado  ON ftth_onu_registro (estado)`);

    // Índice para el cron de recovery: busca registros bloqueados > N minutos
    await qr.query(`
      CREATE INDEX idx_ftth_locked
        ON ftth_onu_registro (locked_at)
        WHERE locked_at IS NOT NULL AND deleted_at IS NULL
    `);

    // ── 4. Trigger updated_at ──────────────────────────────────
    await qr.query(`
      CREATE OR REPLACE FUNCTION ftth_onu_set_updated_at()
      RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$
    `);

    await qr.query(`
      CREATE TRIGGER trg_ftth_onu_updated_at
        BEFORE UPDATE ON ftth_onu_registro
        FOR EACH ROW EXECUTE FUNCTION ftth_onu_set_updated_at()
    `);

    // ── 5. Deprecar tipo_servicio en clientes ──────────────────
    // El campo pasa a ser nullable: ya no se edita directamente.
    // Su valor se deriva de los contratos activos del abonado.
    await qr.query(`
      ALTER TABLE clientes
        ALTER COLUMN tipo_servicio DROP NOT NULL,
        ALTER COLUMN tipo_servicio DROP DEFAULT
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    // Restaurar tipo_servicio en clientes
    await qr.query(`
      UPDATE clientes SET tipo_servicio = 'wisp' WHERE tipo_servicio IS NULL
    `);
    await qr.query(`
      ALTER TABLE clientes
        ALTER COLUMN tipo_servicio SET NOT NULL,
        ALTER COLUMN tipo_servicio SET DEFAULT 'wisp'
    `);

    await qr.query(`DROP TRIGGER IF EXISTS trg_ftth_onu_updated_at ON ftth_onu_registro`);
    await qr.query(`DROP FUNCTION IF EXISTS ftth_onu_set_updated_at`);
    await qr.query(`DROP TABLE IF EXISTS ftth_onu_registro`);
    await qr.query(`DROP TYPE IF EXISTS ftth_onu_estado`);
  }
}
