import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFacturacionDinamica1786700000000 implements MigrationInterface {
  name = 'CreateFacturacionDinamica1786700000000';

  async up(queryRunner: QueryRunner): Promise<void> {

    // ── 1. Tabla: comprobantes_config ─────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS comprobantes_config (
        id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id          UUID          NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nombre              VARCHAR(100)  NOT NULL,
        codigo              VARCHAR(30)   NOT NULL,
        tiene_carga_fiscal  BOOLEAN       NOT NULL DEFAULT TRUE,
        serie               VARCHAR(10)   NOT NULL,
        correlativo_actual  INT           NOT NULL DEFAULT 0,
        es_default          BOOLEAN       NOT NULL DEFAULT FALSE,
        activo              BOOLEAN       NOT NULL DEFAULT TRUE,
        creado_por          UUID,
        created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        deleted_at          TIMESTAMPTZ,
        version             INT           NOT NULL DEFAULT 1,
        CONSTRAINT uq_comprobante_config_empresa_codigo UNIQUE (empresa_id, codigo)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_comprobantes_config_empresa_activo
        ON comprobantes_config (empresa_id, activo)
        WHERE deleted_at IS NULL
    `);

    // ── 2. Tabla: configuracion_facturacion ──────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS configuracion_facturacion (
        id                                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id                        UUID          NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        moneda                            VARCHAR(3)    NOT NULL DEFAULT 'PEN',
        igv_rate                          DECIMAL(5,4)  NOT NULL DEFAULT 0.18,
        mora_acumula_siguiente_ciclo      BOOLEAN       NOT NULL DEFAULT TRUE,
        reconexion_acumula_siguiente_ciclo BOOLEAN      NOT NULL DEFAULT TRUE,
        monto_reconexion                  DECIMAL(10,2) NOT NULL DEFAULT 0,
        porcentaje_mora                   DECIMAL(5,2)  NOT NULL DEFAULT 0,
        actualizado_por                   UUID,
        created_at                        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at                        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        deleted_at                        TIMESTAMPTZ,
        version                           INT           NOT NULL DEFAULT 1,
        CONSTRAINT uq_configuracion_facturacion_empresa UNIQUE (empresa_id)
      )
    `);

    // ── 3. Tabla: cargos_pendientes ──────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS cargos_pendientes (
        id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id            UUID          NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        cliente_id            UUID          NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
        contrato_id           UUID          REFERENCES contratos(id) ON DELETE SET NULL,
        tipo                  VARCHAR(20)   NOT NULL,
        monto                 DECIMAL(12,2) NOT NULL,
        aplica_igv            BOOLEAN       NOT NULL,
        descripcion           TEXT,
        incluido_en_factura_id UUID,
        incluido_en           TIMESTAMPTZ,
        generado_por          UUID,
        created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        deleted_at            TIMESTAMPTZ,
        version               INT           NOT NULL DEFAULT 1
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_cargos_pendientes_cliente_factura
        ON cargos_pendientes (cliente_id, incluido_en_factura_id)
        WHERE deleted_at IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_cargos_pendientes_empresa_factura
        ON cargos_pendientes (empresa_id, incluido_en_factura_id)
        WHERE deleted_at IS NULL
    `);

    // ── 4. Nuevas columnas en facturas ───────────────────────
    await queryRunner.query(`
      ALTER TABLE facturas
        ADD COLUMN IF NOT EXISTS comprobante_config_id UUID,
        ADD COLUMN IF NOT EXISTS tipo_comprobante_nombre VARCHAR(100),
        ADD COLUMN IF NOT EXISTS tiene_carga_fiscal BOOLEAN NOT NULL DEFAULT TRUE
    `);

    // ── 5. Eliminar columnas obsoletas de empresas ───────────
    // (solo si existen — seguro por IF EXISTS)
    await queryRunner.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS serie_boleta`);
    await queryRunner.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS serie_factura`);
    await queryRunner.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS igv_rate`);
    await queryRunner.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS moneda`);
    await queryRunner.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS tipo_comprobante_default`);

    // ── 6. Seed: configuracion_facturacion por empresa ───────
    await queryRunner.query(`
      INSERT INTO configuracion_facturacion (empresa_id)
      SELECT id FROM empresas WHERE deleted_at IS NULL
      ON CONFLICT (empresa_id) DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE facturas DROP COLUMN IF EXISTS comprobante_config_id`);
    await queryRunner.query(`ALTER TABLE facturas DROP COLUMN IF EXISTS tipo_comprobante_nombre`);
    await queryRunner.query(`ALTER TABLE facturas DROP COLUMN IF EXISTS tiene_carga_fiscal`);

    await queryRunner.query(`DROP TABLE IF EXISTS cargos_pendientes`);
    await queryRunner.query(`DROP TABLE IF EXISTS configuracion_facturacion`);
    await queryRunner.query(`DROP TABLE IF EXISTS comprobantes_config`);
  }
}
