import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────
// Migración — OLTs Nativas Multimarca
// Tabla olt_dispositivos: soporte SSH/SNMP/SmartOLT API para
// equipos Huawei, ZTE, VSOL y C-DATA.
// Requiere: migración 006 (trigger_set_updated_at, estado_olt,
//           tabla routers, tabla dispositivos_monitoreo).
// ─────────────────────────────────────────────────────────────
export class CreateOltDispositivos1781700000000 implements MigrationInterface {
  name = 'CreateOltDispositivos1781700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {

    // ── Tipos nuevos (DO block para idempotencia) ─────────────
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE olt_marca AS ENUM ('huawei','zte','vsol','cdata');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE olt_metodo_conexion AS ENUM ('smartolt_api','nativo_ssh','nativo_snmp');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    // ── Tabla principal ───────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE olt_dispositivos (
        id                      UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id              UUID              NOT NULL,

        -- Identificación
        nombre                  VARCHAR(150)      NOT NULL,
        descripcion             TEXT,
        marca                   olt_marca         NOT NULL,
        modelo                  VARCHAR(100),

        -- Conexión
        metodo_conexion         olt_metodo_conexion NOT NULL DEFAULT 'nativo_ssh',
        ip_gestion              INET              NOT NULL,
        puerto                  INTEGER           NOT NULL DEFAULT 22
                                                    CHECK (puerto BETWEEN 1 AND 65535),
        usuario_anclado         VARCHAR(100)      NOT NULL,
        contrasena_cifrada      TEXT              NOT NULL,

        -- Capacidad física
        slots_totales           SMALLINT          NOT NULL DEFAULT 1
                                                    CHECK (slots_totales BETWEEN 1 AND 64),
        puertos_por_slot        SMALLINT          NOT NULL DEFAULT 8
                                                    CHECK (puertos_por_slot BETWEEN 1 AND 128),
        vlan_gestion_defecto    SMALLINT          CHECK (vlan_gestion_defecto BETWEEN 1 AND 4094),

        -- SNMP
        snmp_community          VARCHAR(100)      DEFAULT 'public',
        snmp_version            SMALLINT          NOT NULL DEFAULT 2
                                                    CHECK (snmp_version IN (1, 2, 3)),

        -- Relaciones FK
        router_id               UUID              NOT NULL
                                                    REFERENCES routers(id) ON DELETE RESTRICT,
        dispositivo_monitoreo_id UUID             REFERENCES nodos(id) ON DELETE SET NULL,

        -- Estado operativo (reutiliza tipo existente de migración 006)
        estado                  estado_olt        NOT NULL DEFAULT 'desconocido',
        ultimo_ping             TIMESTAMPTZ,
        total_pon_ports         SMALLINT,
        onus_activas            INTEGER           NOT NULL DEFAULT 0,

        -- Ubicación geográfica
        ubicacion               VARCHAR(200),
        latitud                 DECIMAL(10, 7),
        longitud                DECIMAL(10, 7),

        activo                  BOOLEAN           NOT NULL DEFAULT TRUE,
        created_at              TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
        updated_at              TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
        deleted_at              TIMESTAMPTZ
      )
    `);

    // ── Trigger updated_at ────────────────────────────────────
    await queryRunner.query(`
      CREATE TRIGGER set_updated_at_olt_dispositivos
        BEFORE UPDATE ON olt_dispositivos
        FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at()
    `);

    // ── Índices ───────────────────────────────────────────────
    await queryRunner.query(`
      CREATE INDEX idx_olt_disp_empresa_activo
        ON olt_dispositivos (empresa_id, activo)
        WHERE deleted_at IS NULL;

      CREATE INDEX idx_olt_disp_empresa_marca
        ON olt_dispositivos (empresa_id, marca)
        WHERE deleted_at IS NULL;

      CREATE INDEX idx_olt_disp_router
        ON olt_dispositivos (router_id)
        WHERE deleted_at IS NULL;

      CREATE INDEX idx_olt_disp_ip
        ON olt_dispositivos (ip_gestion);

      COMMENT ON TABLE olt_dispositivos
        IS 'OLTs multimarca (Huawei/ZTE/VSOL/C-DATA) con acceso nativo SSH/SNMP o proxy SmartOLT';
      COMMENT ON COLUMN olt_dispositivos.contrasena_cifrada
        IS 'AES-256-GCM. Formato: iv:authTag:ciphertext (hex)';
      COMMENT ON COLUMN olt_dispositivos.total_pon_ports
        IS 'Caché calculada: slots_totales × puertos_por_slot';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS olt_dispositivos CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS olt_metodo_conexion CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS olt_marca CASCADE`);
  }
}
