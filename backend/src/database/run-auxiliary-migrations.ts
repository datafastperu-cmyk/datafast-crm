// Script standalone para ejecutar migraciones auxiliares.
// Se corre ANTES de pm2 reload en el deploy. Si falla, el servidor
// anterior sigue activo; los módulos auxiliares arrancan en modo degradado.
//
// Uso: ts-node src/database/run-auxiliary-migrations.ts
// Prod: node dist/database/run-auxiliary-migrations.js

import * as dotenv from 'dotenv';
import * as path from 'path';
import { DataSource } from 'typeorm';

dotenv.config({ path: path.resolve(process.cwd(), '.env.production') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const ds = new DataSource({
  type: 'postgres',
  host:     process.env.DATABASE_HOST     || process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DATABASE_PORT || process.env.DB_PORT, 10) || 5432,
  database: process.env.DATABASE_NAME     || process.env.DB_NAME     || 'datafast_db',
  username: process.env.DATABASE_USER     || process.env.DB_USER     || 'datafast_db_user',
  password: process.env.DATABASE_PASSWORD || process.env.DB_PASSWORD,
  ssl: (process.env.DATABASE_SSL || process.env.DB_SSL) === 'true' ? { rejectUnauthorized: false } : false,
  entities:            [path.join(__dirname, '../**/*.entity{.ts,.js}')],
  migrations:          [path.join(__dirname, 'migrations/auxiliary/*{.ts,.js}')],
  migrationsTableName: 'typeorm_migrations',
  migrationsTransactionMode: 'each',
  synchronize: false,
  logging: ['error', 'warn', 'schema'],
});

async function main() {
  try {
    await ds.initialize();
    const pending = await ds.showMigrations();

    if (!pending) {
      console.log('[auxiliary-migrations] Sin migraciones pendientes.');
      process.exit(0);
    }

    console.log('[auxiliary-migrations] Ejecutando migraciones auxiliares...');
    const ran = await ds.runMigrations({ transaction: 'each' });
    console.log(`[auxiliary-migrations] OK — ${ran.length} migración(es) ejecutada(s):`);
    ran.forEach(m => console.log(`  ✓ ${m.name}`));
    process.exit(0);

  } catch (err: any) {
    console.error(`[auxiliary-migrations] ERROR: ${err.message}`);
    console.error('[auxiliary-migrations] El servidor puede iniciar — módulos auxiliares en modo degradado.');
    process.exit(1);
  } finally {
    if (ds.isInitialized) await ds.destroy();
  }
}

main();
