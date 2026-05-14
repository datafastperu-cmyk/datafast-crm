import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────
// Migración 009 — Tickets, Órdenes de Trabajo y Consumo
// Soporte técnico, instalaciones, historial de consumo.
// ─────────────────────────────────────────────────────────────
export class CreateTicketsAndConsumo1700000009000 implements MigrationInterface {
  name = 'CreateTicketsAndConsumo1700000009000';

  public async up(queryRunner: QueryRunner): Promise<void> {

    // ── TICKETS DE SOPORTE ────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE estado_ticket AS ENUM (
        'abierto',
        'en_progreso',
        'pendiente_cliente',
        'pendiente_tecnico',
        'resuelto',
        'cerrado',
        'cancelado'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE prioridad_ticket AS ENUM (
        'baja', 'media', 'alta', 'critica'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE categoria_ticket AS ENUM (
        'sin_internet',
        'lentitud',
        'intermitencia',
        'corte_de_luz',
        'equipo_danado',
        'cambio_plan',
        'cambio_datos',
        'facturacion',
        'instalacion',
        'traslado',
        'otro'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE tickets (
        id                  UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id          UUID            NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        cliente_id          UUID            NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
        contrato_id         UUID            REFERENCES contratos(id) ON DELETE SET NULL,
        tecnico_id          UUID            REFERENCES usuarios(id) ON DELETE SET NULL,
        supervisor_id       UUID            REFERENCES usuarios(id) ON DELETE SET NULL,
        creado_por          UUID            REFERENCES usuarios(id) ON DELETE SET NULL,

        -- Número de ticket
        numero_ticket       VARCHAR(20)     NOT NULL,  -- TKT-2024-000456

        -- Contenido
        titulo              VARCHAR(250)    NOT NULL,
        descripcion         TEXT            NOT NULL,
        categoria           categoria_ticket NOT NULL DEFAULT 'otro',
        prioridad           prioridad_ticket NOT NULL DEFAULT 'media',

        -- Estado
        estado              estado_ticket   NOT NULL DEFAULT 'abierto',
        fecha_estado        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

        -- Tiempos SLA
        sla_horas           SMALLINT        DEFAULT 24,  -- horas para resolver
        fecha_limite_sla    TIMESTAMPTZ,
        sla_cumplido        BOOLEAN,

        -- Resolución
        solucion            TEXT,
        causa_raiz          TEXT,

        -- Multimedia
        imagenes_url        TEXT[],         -- fotos del problema/solución

        -- Encuesta de satisfacción
        calificacion_cliente SMALLINT      CHECK (calificacion_cliente BETWEEN 1 AND 5),
        comentario_cliente  TEXT,
        encuesta_enviada_en TIMESTAMPTZ,

        -- Portal del cliente (abierto por autogestión)
        abierto_por_portal  BOOLEAN        NOT NULL DEFAULT FALSE,

        -- Auditoría
        created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
        closed_at           TIMESTAMPTZ,
        deleted_at          TIMESTAMPTZ,

        UNIQUE (empresa_id, numero_ticket)
      )
    `);

    await queryRunner.query(`
      CREATE TRIGGER set_updated_at_tickets
        BEFORE UPDATE ON tickets
        FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

      CREATE INDEX idx_tickets_empresa
        ON tickets (empresa_id) WHERE deleted_at IS NULL;

      CREATE INDEX idx_tickets_cliente
        ON tickets (cliente_id, created_at DESC) WHERE deleted_at IS NULL;

      CREATE INDEX idx_tickets_tecnico
        ON tickets (tecnico_id, estado) WHERE deleted_at IS NULL;

      CREATE INDEX idx_tickets_estado
        ON tickets (empresa_id, estado, prioridad) WHERE deleted_at IS NULL;

      -- SLA vencidos
      CREATE INDEX idx_tickets_sla
        ON tickets (empresa_id, fecha_limite_sla)
        WHERE estado NOT IN ('resuelto', 'cerrado', 'cancelado') AND deleted_at IS NULL;

      COMMENT ON TABLE tickets IS 'Tickets de soporte técnico del ISP';
    `);

    // COMENTARIOS DEL TICKET
    await queryRunner.query(`
      CREATE TABLE tickets_comentarios (
        id              BIGSERIAL      PRIMARY KEY,
        ticket_id       UUID           NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        empresa_id      UUID           NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        usuario_id      UUID           REFERENCES usuarios(id) ON DELETE SET NULL,

        contenido       TEXT           NOT NULL,
        es_privado      BOOLEAN        NOT NULL DEFAULT FALSE,  -- no visible en portal
        es_nota_interna BOOLEAN        NOT NULL DEFAULT FALSE,
        imagenes_url    TEXT[],

        created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_ticket_comentarios
        ON tickets_comentarios (ticket_id, created_at ASC);
    `);

    // ── ÓRDENES DE TRABAJO ────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE tipo_orden_trabajo AS ENUM (
        'instalacion',
        'retiro',
        'mantenimiento',
        'reparacion',
        'traslado',
        'upgrade_equipo',
        'visita_diagnostico'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE estado_orden_trabajo AS ENUM (
        'programada',
        'en_camino',
        'en_ejecucion',
        'completada',
        'cancelada',
        'reprogramada'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE ordenes_trabajo (
        id                  UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id          UUID              NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        cliente_id          UUID              NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
        contrato_id         UUID              REFERENCES contratos(id) ON DELETE SET NULL,
        ticket_id           UUID              REFERENCES tickets(id) ON DELETE SET NULL,
        tecnico_id          UUID              REFERENCES usuarios(id) ON DELETE SET NULL,
        creada_por          UUID              REFERENCES usuarios(id) ON DELETE SET NULL,

        numero_orden        VARCHAR(20)       NOT NULL,
        tipo                tipo_orden_trabajo NOT NULL,
        estado              estado_orden_trabajo NOT NULL DEFAULT 'programada',

        -- Agendamiento
        fecha_programada    TIMESTAMPTZ       NOT NULL,
        duracion_estimada   SMALLINT          DEFAULT 60,  -- minutos
        fecha_inicio_real   TIMESTAMPTZ,
        fecha_fin_real      TIMESTAMPTZ,

        -- Trabajo realizado
        descripcion_trabajo TEXT,
        materiales_usados   JSONB,  -- [{nombre, cantidad, costo}]
        costo_materiales    DECIMAL(10,2) DEFAULT 0,
        costo_mano_obra     DECIMAL(10,2) DEFAULT 0,

        -- Equipos instalados/retirados
        equipos             JSONB,  -- [{tipo, marca, modelo, serial, accion: 'instalado'|'retirado'}]

        -- Firma del cliente
        firma_cliente_url   VARCHAR(500),
        conformidad_cliente BOOLEAN,
        observaciones       TEXT,

        -- Coordenadas de ejecución
        latitud_ejecucion   DECIMAL(10,7),
        longitud_ejecucion  DECIMAL(10,7),

        -- Auditoría
        created_at          TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
        deleted_at          TIMESTAMPTZ,

        UNIQUE (empresa_id, numero_orden)
      )
    `);

    await queryRunner.query(`
      CREATE TRIGGER set_updated_at_ot
        BEFORE UPDATE ON ordenes_trabajo
        FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

      CREATE INDEX idx_ot_empresa
        ON ordenes_trabajo (empresa_id) WHERE deleted_at IS NULL;

      CREATE INDEX idx_ot_tecnico
        ON ordenes_trabajo (tecnico_id, fecha_programada) WHERE deleted_at IS NULL;

      CREATE INDEX idx_ot_cliente
        ON ordenes_trabajo (cliente_id) WHERE deleted_at IS NULL;

      CREATE INDEX idx_ot_estado_fecha
        ON ordenes_trabajo (empresa_id, estado, fecha_programada)
        WHERE deleted_at IS NULL;

      COMMENT ON TABLE ordenes_trabajo IS 'Órdenes de trabajo para instalaciones, mantenimientos y reparaciones';
    `);

    // ── CONSUMO DE DATOS ──────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE consumo_datos (
        id              BIGSERIAL      PRIMARY KEY,
        empresa_id      UUID           NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        contrato_id     UUID           NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
        cliente_id      UUID           NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,

        -- Período de medición
        fecha           DATE           NOT NULL,
        hora            SMALLINT,      -- NULL = dato diario agregado; 0-23 = dato horario

        -- Tráfico
        rx_bytes        BIGINT         NOT NULL DEFAULT 0,  -- bytes recibidos (bajada)
        tx_bytes        BIGINT         NOT NULL DEFAULT 0,  -- bytes enviados (subida)
        total_bytes     BIGINT         GENERATED ALWAYS AS (rx_bytes + tx_bytes) STORED,

        -- En Mbps promedio del período
        rx_mbps_avg     DECIMAL(10,3),
        tx_mbps_avg     DECIMAL(10,3),
        rx_mbps_max     DECIMAL(10,3),
        tx_mbps_max     DECIMAL(10,3),

        -- Fuente de la medición
        fuente          VARCHAR(30)    DEFAULT 'mikrotik'
                          CHECK (fuente IN ('mikrotik', 'snmp', 'netflow', 'manual')),

        created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

        UNIQUE (contrato_id, fecha, hora)
      )
    `);

    await queryRunner.query(`
      -- Consultas frecuentes: consumo por cliente en rango de fechas
      CREATE INDEX idx_consumo_contrato_fecha
        ON consumo_datos (contrato_id, fecha DESC);

      CREATE INDEX idx_consumo_cliente_fecha
        ON consumo_datos (cliente_id, fecha DESC);

      CREATE INDEX idx_consumo_empresa_fecha
        ON consumo_datos (empresa_id, fecha DESC);

      -- Para datos diarios agregados (hora IS NULL)
      CREATE INDEX idx_consumo_diario
        ON consumo_datos (contrato_id, fecha)
        WHERE hora IS NULL;

      COMMENT ON TABLE consumo_datos IS 'Historial de consumo de datos por contrato (diario y horario)';
      COMMENT ON COLUMN consumo_datos.rx_bytes IS 'Bajada: tráfico recibido por el cliente';
      COMMENT ON COLUMN consumo_datos.tx_bytes IS 'Subida: tráfico enviado por el cliente';
    `);

    // ── NOTIFICACIONES ENVIADAS ───────────────────────────────
    await queryRunner.query(`
      CREATE TYPE canal_notificacion AS ENUM (
        'email', 'whatsapp', 'sms', 'telegram', 'push', 'sistema'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE estado_notificacion AS ENUM (
        'pendiente', 'enviada', 'entregada', 'leida', 'fallida'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE notificaciones (
        id              BIGSERIAL         PRIMARY KEY,
        empresa_id      UUID              NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        cliente_id      UUID              REFERENCES clientes(id) ON DELETE SET NULL,
        usuario_id      UUID              REFERENCES usuarios(id) ON DELETE SET NULL,

        canal           canal_notificacion NOT NULL,
        tipo            VARCHAR(80)        NOT NULL,  -- 'factura_emitida', 'pago_recibido', etc.
        asunto          VARCHAR(250),
        cuerpo          TEXT               NOT NULL,

        estado          estado_notificacion NOT NULL DEFAULT 'pendiente',
        intentos        SMALLINT            NOT NULL DEFAULT 0,
        error           TEXT,

        referencia_id   UUID,              -- ID del objeto relacionado (factura, pago, etc.)
        referencia_tipo VARCHAR(50),       -- 'factura', 'pago', 'ticket', etc.

        programada_para TIMESTAMPTZ,       -- NULL = enviar inmediatamente
        enviada_en      TIMESTAMPTZ,
        leida_en        TIMESTAMPTZ,

        created_at      TIMESTAMPTZ        NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_notif_empresa_estado
        ON notificaciones (empresa_id, estado, programada_para)
        WHERE estado IN ('pendiente', 'fallida');

      CREATE INDEX idx_notif_cliente
        ON notificaciones (cliente_id, created_at DESC) WHERE cliente_id IS NOT NULL;

      COMMENT ON TABLE notificaciones
        IS 'Log de todas las notificaciones enviadas (email, WhatsApp, SMS, Telegram)';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS notificaciones CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS estado_notificacion CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS canal_notificacion CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS consumo_datos CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS ordenes_trabajo CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS estado_orden_trabajo CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS tipo_orden_trabajo CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS tickets_comentarios CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS tickets CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS categoria_ticket CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS prioridad_ticket CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS estado_ticket CASCADE`);
  }
}
