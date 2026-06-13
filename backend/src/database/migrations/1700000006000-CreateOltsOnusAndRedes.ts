import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────
// Migración 006 — OLTs, ONUs y Gestión IPv4
// Equipos FTTH y pools de direcciones IP.
// ─────────────────────────────────────────────────────────────
export class CreateOltsOnusAndRedes1700000006000 implements MigrationInterface {
  name = 'CreateOltsOnusAndRedes1700000006000';

  public async up(queryRunner: QueryRunner): Promise<void> {

    // ── OLTs (Optical Line Terminals) ─────────────────────────
    await queryRunner.query(`
      CREATE TYPE estado_olt AS ENUM (
        'online', 'offline', 'mantenimiento', 'desconocido'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE olts (
        id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id      UUID         NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,

        nombre          VARCHAR(100) NOT NULL,
        descripcion     TEXT,
        marca           VARCHAR(50)  DEFAULT 'Huawei',
        modelo          VARCHAR(100),  -- MA5800-X7, MA5600T, etc.

        -- Conexión SmartOLT
        smartolt_id     VARCHAR(100),  -- ID en SmartOLT
        ip_gestion      INET,
        usuario         VARCHAR(100),
        password_cifrado VARCHAR(500),

        -- Estado
        estado          estado_olt    NOT NULL DEFAULT 'desconocido',
        ultimo_ping     TIMESTAMPTZ,
        total_pon_ports SMALLINT,
        onus_activas    INTEGER       DEFAULT 0,

        -- Ubicación
        ubicacion       VARCHAR(200),
        latitud         DECIMAL(10,7),
        longitud        DECIMAL(10,7),

        activo          BOOLEAN       NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        deleted_at      TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE TRIGGER set_updated_at_olts
        BEFORE UPDATE ON olts
        FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

      CREATE INDEX idx_olts_empresa ON olts (empresa_id) WHERE deleted_at IS NULL;
      COMMENT ON TABLE olts IS 'OLTs Huawei gestionadas vía SmartOLT';
    `);

    // ── ONUs (Optical Network Units) ──────────────────────────
    await queryRunner.query(`
      CREATE TYPE estado_onu AS ENUM (
        'sin_aprovisionar',
        'aprovisionada',
        'online',
        'offline',
        'error',
        'reemplazada'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE onus (
        id                  UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id          UUID         NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        olt_id              UUID         NOT NULL REFERENCES olts(id) ON DELETE RESTRICT,

        -- Identificación ONU
        serial_number       VARCHAR(50)  NOT NULL,
        mac_address         MACADDR,
        modelo              VARCHAR(100),
        marca               VARCHAR(50)  DEFAULT 'Huawei',

        -- PON
        pon_port            VARCHAR(30),   -- ej: '0/1/3'
        pon_slot            SMALLINT,
        pon_subslot         SMALLINT,
        pon_port_num        SMALLINT,
        onu_id              SMALLINT,      -- ID ONU en el puerto PON (0-127)

        -- Perfil SmartOLT
        perfil_smartolt     VARCHAR(100),  -- nombre del perfil en SmartOLT
        smartolt_onu_id     VARCHAR(100),  -- ID en SmartOLT

        -- VLAN
        vlan_id             SMALLINT       CHECK (vlan_id BETWEEN 1 AND 4094),
        vlan_modo           VARCHAR(20)    DEFAULT 'access'
                              CHECK (vlan_modo IN ('access', 'trunk', 'hybrid')),

        -- Estado
        estado              estado_onu     NOT NULL DEFAULT 'sin_aprovisionar',
        rx_power_dbm        DECIMAL(6,2),  -- Potencia óptica de recepción
        tx_power_dbm        DECIMAL(6,2),  -- Potencia óptica de transmisión
        temperatura_c       DECIMAL(5,1),
        voltaje_v           DECIMAL(6,3),
        distancia_km        DECIMAL(8,3),

        -- Aprovisionamiento
        aprovisionada_en    TIMESTAMPTZ,
        aprovisionada_por   UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        ultimo_online       TIMESTAMPTZ,
        descripcion         TEXT,

        -- Auditoría
        created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
        deleted_at          TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE TRIGGER set_updated_at_onus
        BEFORE UPDATE ON onus
        FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

      CREATE INDEX idx_onus_empresa      ON onus (empresa_id) WHERE deleted_at IS NULL;
      CREATE INDEX idx_onus_olt          ON onus (olt_id) WHERE deleted_at IS NULL;
      CREATE INDEX idx_onus_estado       ON onus (empresa_id, estado) WHERE deleted_at IS NULL;
      CREATE INDEX idx_onus_serial       ON onus (serial_number);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_onus_empresa_serial
        ON onus (empresa_id, serial_number)
        WHERE deleted_at IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_onus_olt_pon_id
        ON onus (olt_id, pon_port, onu_id)
        WHERE deleted_at IS NULL AND onu_id IS NOT NULL;

      COMMENT ON TABLE onus IS 'ONUs Huawei aprovisionadas en OLTs mediante SmartOLT';
    `);

    // ── SEGMENTOS IPv4 ────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE segmentos_ipv4 (
        id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id      UUID         NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        router_id       UUID         REFERENCES routers(id) ON DELETE SET NULL,
        nodo_id         UUID         REFERENCES nodos(id) ON DELETE SET NULL,

        -- Red
        nombre          VARCHAR(100) NOT NULL,
        descripcion     TEXT,
        red_cidr        CIDR         NOT NULL,  -- ej: 192.168.1.0/24
        gateway         INET         NOT NULL,
        dns_primario    INET         NOT NULL DEFAULT '8.8.8.8',
        dns_secundario  INET         DEFAULT '8.8.4.4',

        -- IPs reservadas (no asignar a clientes)
        ips_reservadas  INET[],      -- [gateway, broadcast, DNS interno, etc.]

        -- Estadísticas calculadas
        total_ips       INTEGER      NOT NULL DEFAULT 0,
        ips_usadas      INTEGER      NOT NULL DEFAULT 0,
        ips_disponibles INTEGER      GENERATED ALWAYS AS (total_ips - ips_usadas) STORED,

        -- Tipo
        tipo_servicio   tipo_servicio NOT NULL DEFAULT 'ftth',
        vlan_id         SMALLINT      CHECK (vlan_id BETWEEN 1 AND 4094),

        activo          BOOLEAN       NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        deleted_at      TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE TRIGGER set_updated_at_segmentos
        BEFORE UPDATE ON segmentos_ipv4
        FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

      CREATE INDEX idx_segmentos_empresa
        ON segmentos_ipv4 (empresa_id) WHERE deleted_at IS NULL AND activo = TRUE;

      CREATE INDEX idx_segmentos_router
        ON segmentos_ipv4 (router_id) WHERE deleted_at IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_segmentos_empresa_red_cidr
        ON segmentos_ipv4 (empresa_id, red_cidr)
        WHERE deleted_at IS NULL;

      COMMENT ON TABLE segmentos_ipv4 IS 'Segmentos de red IPv4 gestionados para asignación a clientes';
      COMMENT ON COLUMN segmentos_ipv4.ips_reservadas IS 'IPs que no se pueden asignar: gateway, broadcast, DNS, etc.';
    `);

    // ── IPs ASIGNADAS ─────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE ips_asignadas (
        id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id      UUID         NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        segmento_id     UUID         NOT NULL REFERENCES segmentos_ipv4(id) ON DELETE RESTRICT,

        ip_address      INET         NOT NULL,
        -- contrato_id se agrega en migración 007
        descripcion     VARCHAR(200),  -- uso de la IP si no es cliente
        tipo            VARCHAR(30)  DEFAULT 'cliente'
                          CHECK (tipo IN ('cliente', 'reservada', 'infraestructura', 'temporal')),
        activa          BOOLEAN      NOT NULL DEFAULT TRUE,
        asignada_en     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        liberada_en     TIMESTAMPTZ,

        created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

        UNIQUE (segmento_id, ip_address)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_ips_segmento  ON ips_asignadas (segmento_id) WHERE activa = TRUE;
      CREATE INDEX idx_ips_empresa   ON ips_asignadas (empresa_id)  WHERE activa = TRUE;
      CREATE INDEX idx_ips_address   ON ips_asignadas (ip_address);

      COMMENT ON TABLE ips_asignadas IS 'Registro de IPs asignadas de cada segmento para control de duplicados';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS ips_asignadas CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS segmentos_ipv4 CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS onus CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS estado_onu CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS olts CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS estado_olt CASCADE`);
  }
}
