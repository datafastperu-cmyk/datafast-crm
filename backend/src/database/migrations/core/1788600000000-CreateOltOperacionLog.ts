import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────
// Migración — Log de Operaciones OLT
//
// Tabla inmutable de auditoría + idempotencia para operaciones
// sobre OLTs: provisión, desaprovisionamiento, test de conexión,
// discover de ONUs, métricas, estado.
//
// El índice UNIQUE parcial sobre idempotency_key (solo exitosas)
// garantiza que un mismo request duplicado retorne el resultado
// cacheado sin volver a tocar el hardware.
//
// Requiere: 1781700000000-CreateOltDispositivos (tabla olt_dispositivos)
// ─────────────────────────────────────────────────────────────
export class CreateOltOperacionLog1788600000000 implements MigrationInterface {
  name = 'CreateOltOperacionLog1788600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {

    // ── Tipos ENUM (idempotentes) ─────────────────────────────

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE olt_op_tipo AS ENUM
          ('provision', 'deprovision', 'test_conexion', 'discover', 'metricas', 'estado_onu');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE olt_op_estado AS ENUM
          ('pendiente', 'exitoso', 'fallido');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    // ── Tabla principal ───────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE olt_operacion_log (
        id                        UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id                UUID            NOT NULL,

        -- FK a la OLT involucrada
        olt_id                    UUID            NOT NULL
                                    REFERENCES olt_dispositivos(id) ON DELETE RESTRICT,

        -- Serial de la ONU (NULL para operaciones a nivel OLT: test, discover)
        onu_sn                    VARCHAR(20)     NULL,

        -- Tipo de operación ejecutada
        tipo                      olt_op_tipo     NOT NULL,

        -- Clave determinista para idempotencia (sha1 del contexto relevante).
        -- NULL en operaciones que no requieren idempotencia (metricas, test).
        idempotency_key           VARCHAR(120)    NULL,

        -- Proveedores intentados en orden (ej: ['nativo_ssh', 'smartolt'])
        proveedores_intentados    TEXT[]          NOT NULL DEFAULT '{}',

        -- Proveedor que respondió con éxito (NULL si todos fallaron)
        proveedor_exitoso         VARCHAR(20)     NULL,

        estado                    olt_op_estado   NOT NULL DEFAULT 'pendiente',

        -- Resultado completo serializado (payload de retorno del proveedor)
        resultado                 JSONB           NULL,

        -- Mensaje de error del último intento fallido
        error_mensaje             TEXT            NULL,

        -- Duración total incluyendo todos los intentos de fallback
        duracion_ms               INTEGER         NULL,

        -- Usuario que disparó la operación (NULL = sistema/cron)
        usuario_id                UUID            NULL,

        created_at                TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
        updated_at                TIMESTAMPTZ     NOT NULL DEFAULT NOW()
      )
    `);

    // ── Trigger updated_at ────────────────────────────────────
    await queryRunner.query(`
      CREATE TRIGGER set_updated_at_olt_operacion_log
        BEFORE UPDATE ON olt_operacion_log
        FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at()
    `);

    // ── Índices ───────────────────────────────────────────────
    await queryRunner.query(`
      -- Garantía de idempotencia: solo UNA fila exitosa por clave
      CREATE UNIQUE INDEX IF NOT EXISTS idx_olt_op_idempotency_exitoso
        ON olt_operacion_log (idempotency_key)
        WHERE idempotency_key IS NOT NULL
          AND estado = 'exitoso';

      -- Lookup por OLT + SN para historial de una ONU específica
      CREATE INDEX IF NOT EXISTS idx_olt_op_olt_sn_fecha
        ON olt_operacion_log (olt_id, onu_sn, created_at DESC)
        WHERE onu_sn IS NOT NULL;

      -- Lookup por empresa para reportes de auditoría
      CREATE INDEX IF NOT EXISTS idx_olt_op_empresa_fecha
        ON olt_operacion_log (empresa_id, created_at DESC);

      -- Lookup de operaciones pendientes (para detectar operaciones huérfanas)
      CREATE INDEX IF NOT EXISTS idx_olt_op_pendientes
        ON olt_operacion_log (created_at)
        WHERE estado = 'pendiente';

      COMMENT ON TABLE olt_operacion_log
        IS 'Registro inmutable de operaciones OLT: auditoría + idempotencia. No se eliminan filas.';
      COMMENT ON COLUMN olt_operacion_log.idempotency_key
        IS 'SHA-1 determinista del contexto (olt_id+tipo+onu_sn+parámetros). Garantiza exactamente una ejecución.';
      COMMENT ON COLUMN olt_operacion_log.proveedores_intentados
        IS 'Array ordenado de proveedores intentados. Permite diagnóstico de fallback chain.';
      COMMENT ON COLUMN olt_operacion_log.duracion_ms
        IS 'Tiempo total incluyendo todos los intentos de fallback, no solo el exitoso.';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS set_updated_at_olt_operacion_log ON olt_operacion_log`);
    await queryRunner.query(`DROP TABLE IF EXISTS olt_operacion_log CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS olt_op_estado CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS olt_op_tipo CASCADE`);
  }
}
