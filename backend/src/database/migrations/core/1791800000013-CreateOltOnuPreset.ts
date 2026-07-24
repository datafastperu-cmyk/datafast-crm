import { MigrationInterface, QueryRunner } from 'typeorm';

// Preset de auto-config por OLT (la "sección TR-069 de la OLT"): SSID/clave WiFi (plantilla
// por cliente) + credenciales admin web que se inyectan a cada ONU al aprovisionar y se
// re-inyectan tras un factory-reset. Secretos cifrados por la capa de servicio.
export class CreateOltOnuPreset1791800000013 implements MigrationInterface {
  name = 'CreateOltOnuPreset1791800000013';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS olt_onu_preset (
        id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id           uuid        NOT NULL,
        olt_id               uuid        NOT NULL,
        enabled              boolean     NOT NULL DEFAULT false,
        wifi_ssid_template   varchar(64),
        wifi_password        text,
        wifi5g_ssid_template varchar(64),
        wifi5g_password      text,
        onu_admin_user       varchar(64),
        onu_admin_password   text,
        created_at           timestamptz NOT NULL DEFAULT NOW(),
        updated_at           timestamptz NOT NULL DEFAULT NOW(),
        deleted_at           timestamptz,
        version              integer     NOT NULL DEFAULT 1
      )
    `);
    // Un preset por OLT (parcial: ignora filas soft-deleted).
    await qr.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_olt_onu_preset_olt
       ON olt_onu_preset (olt_id) WHERE deleted_at IS NULL`,
    );
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS olt_onu_preset`);
  }
}
