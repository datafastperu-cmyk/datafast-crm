import { MigrationInterface, QueryRunner } from 'typeorm';

// Las acciones de ciclo de vida ONU (FTTH) no usan router MikroTik: la OLT se
// resuelve en ejecución desde el registro. Antes se insertaba router_id='none'
// (inválido para uuid NOT NULL) → el INSERT fallaba silenciosamente y NINGÚN
// comando ONU del outbox llegaba a encolarse. Se permite NULL.
export class ComandosRedRouterIdNullable1791400000000 implements MigrationInterface {
  name = 'ComandosRedRouterIdNullable1791400000000';

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE comandos_red_pendientes ALTER COLUMN router_id DROP NOT NULL`);
  }

  async down(qr: QueryRunner): Promise<void> {
    // Reversible solo si no hay filas con router_id NULL.
    await qr.query(`ALTER TABLE comandos_red_pendientes ALTER COLUMN router_id SET NOT NULL`);
  }
}
