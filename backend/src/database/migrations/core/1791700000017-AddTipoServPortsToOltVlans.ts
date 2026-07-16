import { MigrationInterface, QueryRunner } from 'typeorm';

// 9c — verificación de adopción de VLANs preexistentes: tipo real (smart/mux/
// standard/super) y uso real (service-ports activos) leídos en cada sync.
// Además corrige datos: el parser anterior de 'display vlan all' guardaba la
// columna Type ('smart') como NOMBRE de todas las VLANs sincronizadas.
export class AddTipoServPortsToOltVlans1791700000017 implements MigrationInterface {
  name = 'AddTipoServPortsToOltVlans1791700000017';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE olt_vlans
        ADD COLUMN IF NOT EXISTS tipo VARCHAR(10),
        ADD COLUMN IF NOT EXISTS serv_ports INT;
    `);
    // Fix de datos: nombres corruptos por el bug del parser. Las VLANs
    // externas pasan a nombre sintético; las del ERP no se tocan.
    await queryRunner.query(`
      UPDATE olt_vlans
      SET nombre = 'VLAN-' || vlan_id, tipo = 'smart'
      WHERE nombre = 'smart' AND origen <> 'erp';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE olt_vlans
        DROP COLUMN IF EXISTS tipo,
        DROP COLUMN IF EXISTS serv_ports;
    `);
  }
}
