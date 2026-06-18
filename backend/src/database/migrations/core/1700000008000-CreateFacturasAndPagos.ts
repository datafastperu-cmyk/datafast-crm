import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────
// Migración 008 — Facturas y Pagos
// Módulo financiero completo: comprobantes, métodos de pago,
// conciliación bancaria y notas de crédito.
// ─────────────────────────────────────────────────────────────
export class CreateFacturasAndPagos1700000008000 implements MigrationInterface {
  name = 'CreateFacturasAndPagos1700000008000';

  public async up(queryRunner: QueryRunner): Promise<void> {

    await queryRunner.query(`
      CREATE TYPE tipo_comprobante AS ENUM (
        'boleta',
        'factura',
        'nota_credito',
        'nota_debito',
        'recibo_interno'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE estado_factura AS ENUM (
        'borrador',
        'emitida',
        'pagada',
        'pagada_parcial',
        'vencida',
        'anulada',
        'en_cobranza'
      )
    `);

    // ── FACTURAS ──────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE facturas (
        id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id          UUID          NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        cliente_id          UUID          NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
        contrato_id         UUID          REFERENCES contratos(id) ON DELETE SET NULL,

        -- Numeración SUNAT
        tipo_comprobante    tipo_comprobante NOT NULL DEFAULT 'boleta',
        serie               VARCHAR(10)   NOT NULL,   -- B001, F001
        correlativo         INTEGER       NOT NULL,
        numero_completo     VARCHAR(20)   GENERATED ALWAYS AS (serie || '-' || LPAD(correlativo::text, 8, '0')) STORED,

        -- Periodo facturado
        periodo_inicio      DATE          NOT NULL,
        periodo_fin         DATE          NOT NULL,
        descripcion         TEXT          NOT NULL DEFAULT 'Servicio de internet',

        -- Montos
        subtotal            DECIMAL(12,2) NOT NULL CHECK (subtotal >= 0),
        descuento           DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (descuento >= 0),
        base_imponible      DECIMAL(12,2) GENERATED ALWAYS AS (subtotal - descuento) STORED,
        igv                 DECIMAL(12,2) NOT NULL DEFAULT 0,
        total               DECIMAL(12,2) NOT NULL CHECK (total >= 0),
        monto_pagado        DECIMAL(12,2) NOT NULL DEFAULT 0,
        saldo               DECIMAL(12,2) GENERATED ALWAYS AS (total - monto_pagado) STORED,

        -- Moneda
        moneda              VARCHAR(10)   NOT NULL DEFAULT 'PEN',
        tipo_cambio         DECIMAL(8,4)  DEFAULT 1.0000,

        -- Estado
        estado              estado_factura NOT NULL DEFAULT 'emitida',
        fecha_emision       DATE           NOT NULL DEFAULT CURRENT_DATE,
        fecha_vencimiento   DATE           NOT NULL,
        fecha_pago          DATE,

        -- Items detallados (para facturas con múltiples conceptos)
        items               JSONB          DEFAULT '[]',

        -- PDF
        pdf_url             VARCHAR(500),
        pdf_generado_en     TIMESTAMPTZ,

        -- SUNAT (facturación electrónica)
        sunat_enviada       BOOLEAN        NOT NULL DEFAULT FALSE,
        sunat_aceptada      BOOLEAN,
        sunat_codigo_hash   VARCHAR(200),
        sunat_enlace_xml    VARCHAR(500),
        sunat_enlace_cdr    VARCHAR(500),
        sunat_error         TEXT,
        sunat_enviada_en    TIMESTAMPTZ,

        -- Nota de crédito (referencia a factura original)
        factura_original_id UUID           REFERENCES facturas(id) ON DELETE SET NULL,
        motivo_anulacion    TEXT,
        anulada_en          TIMESTAMPTZ,
        anulada_por         UUID           REFERENCES usuarios(id),

        -- Generación
        generada_automaticamente BOOLEAN   NOT NULL DEFAULT FALSE,
        enviada_por_email   BOOLEAN        NOT NULL DEFAULT FALSE,
        enviada_por_whatsapp BOOLEAN       NOT NULL DEFAULT FALSE,

        -- Auditoría
        created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
        deleted_at          TIMESTAMPTZ,
        created_by          UUID           REFERENCES usuarios(id),

        UNIQUE (empresa_id, serie, correlativo)
      )
    `);

    await queryRunner.query(`
      CREATE TRIGGER set_updated_at_facturas
        BEFORE UPDATE ON facturas
        FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

      -- Índices de cobranza frecuente
      CREATE INDEX idx_facturas_empresa
        ON facturas (empresa_id) WHERE deleted_at IS NULL;

      CREATE INDEX idx_facturas_cliente
        ON facturas (cliente_id, fecha_emision DESC) WHERE deleted_at IS NULL;

      CREATE INDEX idx_facturas_contrato
        ON facturas (contrato_id) WHERE deleted_at IS NULL;

      CREATE INDEX idx_facturas_estado
        ON facturas (empresa_id, estado, fecha_vencimiento)
        WHERE deleted_at IS NULL;

      -- Para el dashboard: facturas del mes
      CREATE INDEX idx_facturas_periodo
        ON facturas (empresa_id, fecha_emision DESC) WHERE deleted_at IS NULL;

      -- Para alertas de vencimiento
      CREATE INDEX idx_facturas_vencimiento
        ON facturas (empresa_id, fecha_vencimiento, estado)
        WHERE estado IN ('emitida', 'pagada_parcial') AND deleted_at IS NULL;

      COMMENT ON TABLE facturas IS 'Facturas y boletas del ISP, con soporte SUNAT';
      COMMENT ON COLUMN facturas.items IS 'JSON array de items: [{descripcion, cantidad, precio_unitario, subtotal}]';
    `);

    // ── MÉTODOS DE PAGO ───────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE metodo_pago AS ENUM (
        'efectivo',
        'yape',
        'plin',
        'transferencia_bancaria',
        'deposito_bancario',
        'mercadopago',
        'tarjeta_credito',
        'tarjeta_debito',
        'cheque',
        'otro'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE estado_pago AS ENUM (
        'pendiente_verificacion',
        'verificado',
        'rechazado',
        'devuelto'
      )
    `);

    // ── PAGOS ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE pagos (
        id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id          UUID          NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        cliente_id          UUID          NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
        factura_id          UUID          REFERENCES facturas(id) ON DELETE SET NULL,
        contrato_id         UUID          REFERENCES contratos(id) ON DELETE SET NULL,

        -- Monto
        monto               DECIMAL(12,2) NOT NULL CHECK (monto > 0),
        moneda              VARCHAR(10)   NOT NULL DEFAULT 'PEN',

        -- Método
        metodo_pago         metodo_pago   NOT NULL,
        banco               VARCHAR(100), -- BCP, Interbank, BBVA, Scotiabank, etc.
        numero_operacion    VARCHAR(100), -- número de transacción del banco/Yape
        numero_cuenta       VARCHAR(50),  -- últimos 4 dígitos de cuenta destino

        -- Estado y verificación
        estado              estado_pago   NOT NULL DEFAULT 'pendiente_verificacion',
        verificado_por      UUID          REFERENCES usuarios(id) ON DELETE SET NULL,
        verificado_en       TIMESTAMPTZ,
        motivo_rechazo      TEXT,

        -- Imagen del comprobante
        comprobante_url     VARCHAR(500), -- foto del voucher subida

        -- MercadoPago
        mp_payment_id       VARCHAR(100),
        mp_status           VARCHAR(50),
        mp_preference_id    VARCHAR(100),

        -- Fecha
        fecha_pago          DATE          NOT NULL DEFAULT CURRENT_DATE,
        registrado_en       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

        -- Cajero que registró el pago
        cajero_id           UUID          REFERENCES usuarios(id) ON DELETE SET NULL,

        -- Notas
        notas               TEXT,

        -- Conciliación bancaria
        conciliado          BOOLEAN       NOT NULL DEFAULT FALSE,
        conciliado_en       TIMESTAMPTZ,
        conciliado_por      UUID          REFERENCES usuarios(id),
        extracto_banco_ref  VARCHAR(200), -- referencia en el extracto bancario

        -- Auditoría
        created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

        -- Anti-duplicados: mismo número de operación = mismo pago
        UNIQUE (empresa_id, metodo_pago, numero_operacion)
      )
    `);

    await queryRunner.query(`
      CREATE TRIGGER set_updated_at_pagos
        BEFORE UPDATE ON pagos
        FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

      CREATE INDEX idx_pagos_empresa
        ON pagos (empresa_id, fecha_pago DESC);

      CREATE INDEX idx_pagos_cliente
        ON pagos (cliente_id, fecha_pago DESC);

      CREATE INDEX idx_pagos_factura
        ON pagos (factura_id) WHERE factura_id IS NOT NULL;

      CREATE INDEX idx_pagos_estado
        ON pagos (empresa_id, estado) WHERE estado = 'pendiente_verificacion';

      CREATE INDEX idx_pagos_metodo
        ON pagos (empresa_id, metodo_pago, fecha_pago DESC);

      -- Para el dashboard: pagos del día / mes
      CREATE INDEX idx_pagos_fecha
        ON pagos (empresa_id, registrado_en DESC);

      -- Anti-duplicados por número de operación
      CREATE INDEX idx_pagos_num_operacion
        ON pagos (empresa_id, numero_operacion)
        WHERE numero_operacion IS NOT NULL;

      COMMENT ON TABLE pagos IS 'Pagos registrados de clientes con verificación y conciliación bancaria';
      COMMENT ON COLUMN pagos.numero_operacion IS 'Número de operación del banco/Yape/Plin para verificar duplicados';
    `);

    // CUENTAS BANCARIAS DE LA EMPRESA
    await queryRunner.query(`
      CREATE TABLE cuentas_bancarias (
        id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id      UUID         NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        banco           VARCHAR(100) NOT NULL,
        tipo_cuenta     VARCHAR(50)  DEFAULT 'corriente'
                          CHECK (tipo_cuenta IN ('corriente', 'ahorros', 'recaudadora')),
        numero_cuenta   VARCHAR(50)  NOT NULL,
        cci             VARCHAR(50),   -- código de cuenta interbancario
        moneda          VARCHAR(10)  DEFAULT 'PEN',
        titular         VARCHAR(200),
        activa          BOOLEAN      NOT NULL DEFAULT TRUE,
        es_principal    BOOLEAN      NOT NULL DEFAULT FALSE,
        logo_banco      VARCHAR(200),
        created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

        UNIQUE (empresa_id, numero_cuenta)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_cuentas_empresa
        ON cuentas_bancarias (empresa_id) WHERE activa = TRUE;

      COMMENT ON TABLE cuentas_bancarias
        IS 'Cuentas bancarias de la empresa para recibir pagos';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS cuentas_bancarias CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS pagos CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS estado_pago CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS metodo_pago CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS facturas CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS estado_factura CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS tipo_comprobante CASCADE`);
  }
}
