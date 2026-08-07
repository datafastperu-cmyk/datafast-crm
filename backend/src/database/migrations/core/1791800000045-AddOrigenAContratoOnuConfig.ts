import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────────────────────
// Origen de la config de ONU — convierte en regla lo que hoy es un efecto lateral.
//
// EL PROBLEMA
// Los dos reconciliadores del pipeline ZTP reescriben SSID, clave WiFi y credenciales
// de acceso web de toda ONU con `provisioning_enabled = true` y drift:
//
//   ztp.reconcile()                  03:30       provisioning_enabled AND (rev NULL OR <)
//   ztp.reconcilePendingReinjection() cada 2 min  provisioning_enabled AND rev IS NULL
//
// Una ONU incorporada por migración tiene exactamente `last_applied_revision IS NULL`:
// la captura el watcher de DOS MINUTOS, no el nocturno. No hay una noche de margen.
//
// POR QUÉ HOY NO EXPLOTA — y por qué eso no basta
// Tres decisiones independientes lo impiden por composición:
//   1. `_nuevo()` crea siempre con provisioning_enabled = false, revision = 0.
//   2. `adoptarOnusHuerfanas` inserta solo en ftth_onu_registro; no crea esta fila.
//   3. El único camino automático a provisioning_enabled = true es el preset,
//      invocado solo desde la provisión FTTH que hace el propio ERP.
//
// Ninguna de las tres DICE "no toques una ONU que no aprovisionamos". Un script de
// migración que llame a upsert() + setProvisioningEnabled(true) —lo natural para dejar
// la ficha lista— anula las tres a la vez, y el daño empieza dos minutos después:
// cientos de clientes reales, con años de configuración propia, sin WiFi a la mañana
// siguiente y sin nadie que sepa por qué.
//
// LA REGLA
// `origen` declara quién trajo esta ONU al ERP. El auto-config solo actúa sobre 'erp'.
// Una ONU que ya funcionaba se ADOPTA —se observa y se respeta—, nunca se reconfigura.
//
// POR QUÉ EL DEFAULT ES 'erp' Y ES SEGURO
// No es una suposición: es verificable en el código. Las únicas rutas que crean filas en
// esta tabla son upsert(), generateWifi(), ensureConnReq() y el preset, y las cuatro se
// invocan desde la provisión o la administración del propio ERP. No existe hoy ninguna
// ruta de adopción ni de migración que la escriba. Por tanto toda fila existente es 'erp'.
//
// Referencias: ADR-014 · POL-001 PP-10 y desviación A-2 · RDM-001 R1.
// ─────────────────────────────────────────────────────────────────────────────
export class AddOrigenAContratoOnuConfig1791800000045 implements MigrationInterface {
  name = 'AddOrigenAContratoOnuConfig1791800000045';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE contrato_onu_config
        ADD COLUMN IF NOT EXISTS origen VARCHAR(16) NOT NULL DEFAULT 'erp'
    `);

    // El CHECK cierra la puerta a un tercer valor inventado sobre la marcha: un origen
    // desconocido dejaría de filtrarse como 'erp' sin que nadie lo note.
    await qr.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'ck_contrato_onu_config_origen'
        ) THEN
          ALTER TABLE contrato_onu_config
            ADD CONSTRAINT ck_contrato_onu_config_origen
            CHECK (origen IN ('erp', 'adoptada', 'migrada'));
        END IF;
      END $$
    `);

    await qr.query(`
      COMMENT ON COLUMN contrato_onu_config.origen IS
        'Quién trajo esta ONU al ERP. Solo origen=erp entra en el auto-config del pipeline ZTP. adoptada/migrada se observan y se respetan, nunca se reconfiguran (ADR-014).'
    `);

    // Índice del pre-flight de migración: la consulta que debe ejecutarse ANTES de
    // cualquier incorporación masiva cuenta el drift agrupado por origen.
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_contrato_onu_config_origen_drift
        ON contrato_onu_config (origen)
        WHERE provisioning_enabled AND deleted_at IS NULL
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_contrato_onu_config_origen_drift`);
    await qr.query(`
      ALTER TABLE contrato_onu_config
        DROP CONSTRAINT IF EXISTS ck_contrato_onu_config_origen
    `);
    await qr.query(`ALTER TABLE contrato_onu_config DROP COLUMN IF EXISTS origen`);
  }
}
