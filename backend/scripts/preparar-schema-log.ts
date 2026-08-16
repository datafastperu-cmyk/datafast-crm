// ═══════════════════════════════════════════════════════════════════════════
// Precondición de `db:check` (`typeorm schema:log`) — hallazgo Ola 0, 2026-08-16.
//
// `schema:log` lee `typeorm_metadata` para resolver columnas GENERATED (la tiene
// `segmentos_ipv4.ips_disponibles`), pero a diferencia de `synchronize()` no la crea si falta.
// En una instalación levantada solo con migraciones —el método que D-40 exige verificar—
// esa tabla nunca existe, y `schema:log` revienta con "relation typeorm_metadata does not
// exist" en vez de comparar. No es una migración: es la misma tabla de bookkeeping interno
// que `synchronize()` crea de forma condicional (`createMetadataTableIfNecessary`, TypeORM
// RdbmsSchemaBuilder). Este script llama exactamente a ese método — nada más — antes de que
// `db:check` lea el esquema. No sincroniza tablas ni columnas: `synchronize()` real está,
// deliberadamente, fuera de este repositorio.
// ═══════════════════════════════════════════════════════════════════════════

import dataSource from '../src/config/datasource';

async function main() {
  await dataSource.initialize();
  try {
    const runner = dataSource.createQueryRunner();
    try {
      const builder = dataSource.driver.createSchemaBuilder() as unknown as {
        createTypeormMetadataTable: (qr: typeof runner) => Promise<void>;
      };
      // Directo, no el condicional `...IfNecessary`: crear de más una tabla de bookkeeping
      // interna (CREATE TABLE IF NOT EXISTS) es inofensivo; el condicional depende de que
      // `hasGeneratedColumns()` vea la metadata de entidades en este contexto aislado, y no
      // vale la pena depender de ese detalle interno para algo que solo debe pasar una vez.
      await builder.createTypeormMetadataTable(runner);
    } finally {
      await runner.release();
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((e) => { console.error('preparar-schema-log:', e.message); process.exit(1); });
