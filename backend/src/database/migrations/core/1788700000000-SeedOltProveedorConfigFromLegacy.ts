import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────
// Migración — Seed inicial de olt_proveedor_config
//
// Toma cada fila de olt_dispositivos y crea su proveedor primario
// en olt_proveedor_config basándose en el campo metodo_conexion
// heredado.  Solo inserta — nunca modifica olt_dispositivos.
//
// Después de esta migración, el sistema multi-proveedor reconoce
// todas las OLTs existentes sin cambio de comportamiento.
//
// ON CONFLICT DO NOTHING → idempotente: si se ejecuta dos veces
// no produce duplicados ni errores.
//
// Requiere: 1788500000000-CreateOltProveedorConfig
// ─────────────────────────────────────────────────────────────
export class SeedOltProveedorConfigFromLegacy1788700000000 implements MigrationInterface {
  name = 'SeedOltProveedorConfigFromLegacy1788700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {

    // Mapeo de metodo_conexion → proveedor_olt_tipo:
    //   'smartolt_api' → 'smartolt'   activo=FALSE (requiere base_url/api_key manual)
    //   'nativo_ssh'   → 'nativo_ssh' activo=d.activo (credenciales copiadas desde legacy)
    //   'nativo_snmp'  → 'nativo_snmp' activo=d.activo
    //
    // ⚠️  SmartOLT se inserta con activo=FALSE para evitar regresión:
    //     sin base_url/api_key el Router fallaría y NO hay fallback al
    //     path legacy (solo InternalServerErrorException dispara ese fallback).
    //     El operador debe abrir /configuracion/olts → pestaña Proveedores,
    //     completar las credenciales y activar la fila manualmente.
    await queryRunner.query(`
      INSERT INTO olt_proveedor_config
        (id, empresa_id, olt_id, tipo, prioridad, credenciales, activo)
      SELECT
        uuid_generate_v4(),
        d.empresa_id,
        d.id,
        CASE d.metodo_conexion
          WHEN 'smartolt_api' THEN 'smartolt'::proveedor_olt_tipo
          WHEN 'nativo_ssh'   THEN 'nativo_ssh'::proveedor_olt_tipo
          WHEN 'nativo_snmp'  THEN 'nativo_snmp'::proveedor_olt_tipo
        END,
        1,
        jsonb_build_object(
          'ip',                d.ip_gestion::TEXT,
          'port',              d.puerto,
          'username',          d.usuario_anclado,
          'password_cifrado',  d.contrasena_cifrada,
          'brand',             d.marca::TEXT,
          'snmp_community',    COALESCE(d.snmp_community, 'public'),
          'snmp_version',      d.snmp_version
        ),
        -- SmartOLT sin base_url/api_key → inactivo hasta configuración manual
        CASE d.metodo_conexion
          WHEN 'smartolt_api' THEN FALSE
          ELSE d.activo
        END
      FROM olt_dispositivos d
      WHERE d.deleted_at IS NULL
      ON CONFLICT (olt_id, tipo) DO NOTHING
    `);

    // Reporte de filas por tipo (visible en logs de migración)
    await queryRunner.query(`
      DO $$
      DECLARE
        n_total    INTEGER;
        n_ssh      INTEGER;
        n_snmp     INTEGER;
        n_smartolt INTEGER;
      BEGIN
        SELECT COUNT(*)                                    INTO n_total    FROM olt_proveedor_config;
        SELECT COUNT(*) FILTER (WHERE tipo = 'nativo_ssh')  INTO n_ssh      FROM olt_proveedor_config;
        SELECT COUNT(*) FILTER (WHERE tipo = 'nativo_snmp') INTO n_snmp     FROM olt_proveedor_config;
        SELECT COUNT(*) FILTER (WHERE tipo = 'smartolt')    INTO n_smartolt FROM olt_proveedor_config;
        RAISE NOTICE 'olt_proveedor_config seed: % filas totales (nativo_ssh=%, nativo_snmp=%, smartolt=% — estos últimos inactivos, requieren config manual)', n_total, n_ssh, n_snmp, n_smartolt;
      END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Elimina solo las filas que fueron generadas por este seed
    // (prioridad=1 y sin base_url, que son las que crea este script).
    // Las filas añadidas manualmente por el operador NO se eliminan.
    await queryRunner.query(`
      DELETE FROM olt_proveedor_config
      WHERE prioridad = 1
        AND NOT (credenciales ? 'base_url')
        AND (credenciales ? 'password_cifrado')
    `);
  }
}
