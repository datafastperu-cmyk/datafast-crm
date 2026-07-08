import { MigrationInterface, QueryRunner } from 'typeorm';

// Regla de negocio: una OLT admite UN SOLO proveedor (el que se fija al registrarla).
// Antes la unique era (olt_id, tipo) → permitía varios tipos por OLT. Se refuerza a
// un único proveedor ACTIVO por OLT. Defensivo: si algún OLT tuviera >1 activo, deja
// el de mayor prioridad (menor número) y desactiva el resto antes de crear el índice.
export class OltUnProveedorPorOlt1791500000000 implements MigrationInterface {
  name = 'OltUnProveedorPorOlt1791500000000';

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (
                 PARTITION BY olt_id ORDER BY prioridad ASC, id ASC
               ) AS rn
          FROM olt_proveedor_config
         WHERE activo = true
      )
      UPDATE olt_proveedor_config
         SET activo = false
       WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
    `);
    await qr.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_olt_prov_un_activo
        ON olt_proveedor_config (olt_id) WHERE activo = true
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS uq_olt_prov_un_activo`);
  }
}
