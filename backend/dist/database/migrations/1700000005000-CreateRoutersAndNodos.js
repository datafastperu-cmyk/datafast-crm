"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateRoutersAndNodos1700000005000 = void 0;
class CreateRoutersAndNodos1700000005000 {
    constructor() {
        this.name = 'CreateRoutersAndNodos1700000005000';
    }
    async up(queryRunner) {
        await queryRunner.query(`
      CREATE TYPE version_routeros AS ENUM ('v6', 'v7', 'desconocida')
    `);
        await queryRunner.query(`
      CREATE TYPE metodo_conexion_router AS ENUM ('api', 'ssh', 'api_ssl', 'snmp')
    `);
        await queryRunner.query(`
      CREATE TYPE estado_equipo AS ENUM (
        'online', 'offline', 'degradado', 'mantenimiento', 'desconocido'
      )
    `);
        await queryRunner.query(`
      CREATE TABLE routers (
        id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id          UUID          NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,

        -- Identificación
        nombre              VARCHAR(100)  NOT NULL,
        descripcion         TEXT,
        ubicacion           VARCHAR(200),
        modelo              VARCHAR(100),  -- ej: CCR1036, hAP ax3

        -- Conexión
        ip_gestion          INET          NOT NULL,
        puerto_api          SMALLINT      NOT NULL DEFAULT 8728,
        puerto_api_ssl      SMALLINT      NOT NULL DEFAULT 8729,
        puerto_ssh          SMALLINT      NOT NULL DEFAULT 22,
        usuario             VARCHAR(100)  NOT NULL,
        password_cifrado    VARCHAR(500)  NOT NULL,   -- AES-256-GCM
        version_ros         version_routeros NOT NULL DEFAULT 'desconocida',
        metodo_conexion     metodo_conexion_router NOT NULL DEFAULT 'api',
        usar_ssl            BOOLEAN       NOT NULL DEFAULT FALSE,
        timeout_conexion    SMALLINT      NOT NULL DEFAULT 10,  -- segundos

        -- Estado y monitoreo
        estado              estado_equipo NOT NULL DEFAULT 'desconocido',
        ultimo_ping         TIMESTAMPTZ,
        latencia_ms         DECIMAL(8,2),
        uptime_segundos     BIGINT,
        version_firmware    VARCHAR(50),
        identity_routeros   VARCHAR(100), -- hostname del router

        -- Recursos del router
        cpu_uso_pct         DECIMAL(5,2),
        memoria_uso_pct     DECIMAL(5,2),
        temperatura_c       DECIMAL(5,1),

        -- Coordenadas (para mapa de red)
        latitud             DECIMAL(10,7),
        longitud            DECIMAL(10,7),

        -- Configuración automática
        auto_configurar_queues   BOOLEAN  NOT NULL DEFAULT TRUE,
        auto_configurar_pppoe    BOOLEAN  NOT NULL DEFAULT TRUE,
        auto_configurar_firewall BOOLEAN  NOT NULL DEFAULT TRUE,

        -- SNMP
        snmp_community      VARCHAR(100) DEFAULT 'public',
        snmp_version        SMALLINT     DEFAULT 2,  -- 1, 2, 3

        -- Auditoría
        activo              BOOLEAN      NOT NULL DEFAULT TRUE,
        created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        deleted_at          TIMESTAMPTZ,

        UNIQUE (empresa_id, ip_gestion)
      )
    `);
        await queryRunner.query(`
      CREATE TRIGGER set_updated_at_routers
        BEFORE UPDATE ON routers
        FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

      CREATE INDEX idx_routers_empresa
        ON routers (empresa_id) WHERE deleted_at IS NULL AND activo = TRUE;

      CREATE INDEX idx_routers_estado
        ON routers (empresa_id, estado) WHERE deleted_at IS NULL;

      CREATE INDEX idx_routers_ip
        ON routers (ip_gestion) WHERE deleted_at IS NULL;

      COMMENT ON TABLE routers IS 'Routers Mikrotik gestionados por el sistema';
      COMMENT ON COLUMN routers.password_cifrado IS 'Password cifrada con AES-256-GCM, nunca almacenar en texto plano';
    `);
        await queryRunner.query(`
      CREATE TYPE tipo_nodo AS ENUM (
        'antena_wisp',
        'nodo_distribucion',
        'torre_principal',
        'caja_nap',           -- caja de acceso para FTTH
        'olt',
        'onu',
        'switch',
        'otro'
      )
    `);
        await queryRunner.query(`
      CREATE TABLE nodos (
        id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id      UUID          NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        router_id       UUID          REFERENCES routers(id) ON DELETE SET NULL,

        -- Identificación
        nombre          VARCHAR(100)  NOT NULL,
        descripcion     TEXT,
        tipo            tipo_nodo     NOT NULL DEFAULT 'antena_wisp',
        modelo          VARCHAR(100),
        marca           VARCHAR(100),

        -- Red
        ip_gestion      INET,
        mac_address     MACADDR,
        ssid            VARCHAR(100),
        frecuencia_mhz  INTEGER,      -- 2400, 5000, 5800, etc.
        canal           SMALLINT,
        potencia_tx_dbm SMALLINT,

        -- Ubicación
        direccion       TEXT,
        latitud         DECIMAL(10,7),
        longitud        DECIMAL(10,7),
        altura_metros   DECIMAL(6,1), -- altura de instalación

        -- Monitoreo
        estado          estado_equipo  NOT NULL DEFAULT 'desconocido',
        ultimo_ping     TIMESTAMPTZ,
        latencia_ms     DECIMAL(8,2),
        packet_loss_pct DECIMAL(5,2),
        uptime_segundos BIGINT,

        -- Tráfico (última medición)
        trafico_rx_bps  BIGINT,       -- bytes por segundo entrada
        trafico_tx_bps  BIGINT,       -- bytes por segundo salida
        trafico_rx_total BIGINT,      -- bytes totales recibidos
        trafico_tx_total BIGINT,      -- bytes totales enviados
        clientes_conectados INTEGER DEFAULT 0,

        -- SNMP
        snmp_community  VARCHAR(100)  DEFAULT 'public',
        snmp_oid_rx     VARCHAR(200), -- OID personalizado para RX
        snmp_oid_tx     VARCHAR(200), -- OID personalizado para TX

        -- Alertas
        umbral_latencia_ms    INTEGER DEFAULT 100,
        umbral_packet_loss    DECIMAL(5,2) DEFAULT 10.00,
        umbral_uso_bw_pct     DECIMAL(5,2) DEFAULT 80.00,
        notificar_caida       BOOLEAN NOT NULL DEFAULT TRUE,

        activo          BOOLEAN        NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
        deleted_at      TIMESTAMPTZ
      )
    `);
        await queryRunner.query(`
      CREATE TRIGGER set_updated_at_nodos
        BEFORE UPDATE ON nodos
        FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

      CREATE INDEX idx_nodos_empresa
        ON nodos (empresa_id) WHERE deleted_at IS NULL AND activo = TRUE;

      CREATE INDEX idx_nodos_router
        ON nodos (router_id) WHERE deleted_at IS NULL;

      CREATE INDEX idx_nodos_estado
        ON nodos (empresa_id, estado) WHERE deleted_at IS NULL;

      CREATE INDEX idx_nodos_gps
        ON nodos (latitud, longitud)
        WHERE latitud IS NOT NULL AND longitud IS NOT NULL;

      COMMENT ON TABLE nodos IS 'Antenas, nodos y equipos de red WISP/FTTH monitoreados';
    `);
        await queryRunner.query(`
      CREATE TABLE nodos_mediciones (
        id              BIGSERIAL      PRIMARY KEY,
        nodo_id         UUID           NOT NULL REFERENCES nodos(id) ON DELETE CASCADE,
        empresa_id      UUID           NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,

        latencia_ms     DECIMAL(8,2),
        packet_loss_pct DECIMAL(5,2),
        trafico_rx_bps  BIGINT,
        trafico_tx_bps  BIGINT,
        clientes_conectados INTEGER,
        estado          estado_equipo  NOT NULL,
        medido_en       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
      )
    `);
        await queryRunner.query(`
      CREATE INDEX idx_nodos_med_nodo_tiempo
        ON nodos_mediciones (nodo_id, medido_en DESC);

      CREATE INDEX idx_nodos_med_empresa_tiempo
        ON nodos_mediciones (empresa_id, medido_en DESC);

      COMMENT ON TABLE nodos_mediciones
        IS 'Historial de mediciones de monitoreo — retener 90 días, luego agregar por día';
    `);
    }
    async down(queryRunner) {
        await queryRunner.query(`DROP TABLE IF EXISTS nodos_mediciones CASCADE`);
        await queryRunner.query(`DROP TABLE IF EXISTS nodos CASCADE`);
        await queryRunner.query(`DROP TYPE IF EXISTS tipo_nodo CASCADE`);
        await queryRunner.query(`DROP TABLE IF EXISTS routers CASCADE`);
        await queryRunner.query(`DROP TYPE IF EXISTS metodo_conexion_router CASCADE`);
        await queryRunner.query(`DROP TYPE IF EXISTS version_routeros CASCADE`);
        await queryRunner.query(`DROP TYPE IF EXISTS estado_equipo CASCADE`);
    }
}
exports.CreateRoutersAndNodos1700000005000 = CreateRoutersAndNodos1700000005000;
//# sourceMappingURL=1700000005000-CreateRoutersAndNodos.js.map