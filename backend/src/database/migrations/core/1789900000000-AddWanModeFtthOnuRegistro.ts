import { MigrationInterface, QueryRunner } from 'typeorm';

// Modo WAN por ONU: 'bridge' (PPPoE en el router del cliente, sin inyección OMCI)
// o 'routing' (PPPoE inyectado en la ONU vía OMCI). Default 'bridge' — el caso más
// común en este despliegue (la ONU va transparente y el BRAS MikroTik hace PPPoE).
export class AddWanModeFtthOnuRegistro1789900000000 implements MigrationInterface {
  name = 'AddWanModeFtthOnuRegistro1789900000000';

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE ftth_onu_registro
      ADD COLUMN IF NOT EXISTS wan_mode VARCHAR(10) NOT NULL DEFAULT 'bridge'
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE ftth_onu_registro DROP COLUMN IF EXISTS wan_mode`);
  }
}
