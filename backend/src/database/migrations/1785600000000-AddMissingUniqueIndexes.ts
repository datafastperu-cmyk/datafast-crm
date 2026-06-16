import { MigrationInterface, QueryRunner } from 'typeorm';

// Agrega índices únicos parciales faltantes para garantizar unicidad a nivel de BD.
// Si algún índice falla por datos duplicados existentes, limpiar primero con:
//   SELECT campo, empresa_id, COUNT(*) FROM tabla GROUP BY campo, empresa_id HAVING COUNT(*) > 1;
export class AddMissingUniqueIndexes1785600000000 implements MigrationInterface {
  name = 'AddMissingUniqueIndexes1785600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── contratos: usuario_pppoe único por empresa (excluye baja_definitiva) ──
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_contratos_empresa_pppoe
        ON contratos (empresa_id, usuario_pppoe)
        WHERE usuario_pppoe IS NOT NULL
          AND estado != 'baja_definitiva'
          AND deleted_at IS NULL
    `);

    // ── contratos: mac_address única por empresa (excluye baja_definitiva) ───
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_contratos_empresa_mac
        ON contratos (empresa_id, mac_address)
        WHERE mac_address IS NOT NULL
          AND estado != 'baja_definitiva'
          AND deleted_at IS NULL
    `);

    // ── contratos: ip_asignada única por empresa (excluye baja_definitiva) ──
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_contratos_empresa_ip
        ON contratos (empresa_id, ip_asignada)
        WHERE ip_asignada IS NOT NULL
          AND estado != 'baja_definitiva'
          AND deleted_at IS NULL
    `);

    // ── routers: nombre único por empresa ────────────────────────────────────
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_routers_empresa_nombre
        ON routers (empresa_id, nombre)
        WHERE deleted_at IS NULL
    `);

    // ── routers: vpn_ip única por empresa ───────────────────────────────────
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_routers_empresa_vpn_ip
        ON routers (empresa_id, vpn_ip)
        WHERE vpn_ip IS NOT NULL
          AND deleted_at IS NULL
    `);

    // ── clientes: email único por empresa ────────────────────────────────────
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_clientes_empresa_email
        ON clientes (empresa_id, email)
        WHERE email IS NOT NULL
          AND email != ''
          AND deleted_at IS NULL
    `);

    // ── clientes: teléfono único por empresa ─────────────────────────────────
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_clientes_empresa_telefono
        ON clientes (empresa_id, telefono)
        WHERE telefono IS NOT NULL
          AND telefono != ''
          AND deleted_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_clientes_empresa_telefono`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_clientes_empresa_email`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_routers_empresa_vpn_ip`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_routers_empresa_nombre`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_contratos_empresa_ip`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_contratos_empresa_mac`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_contratos_empresa_pppoe`);
  }
}
