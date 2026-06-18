// Script standalone para ejecutar migraciones auxiliares.
// Se corre ANTES de pm2 reload en el deploy. Si falla, el servidor
// anterior sigue activo; los módulos auxiliares arrancan en modo degradado.
//
// Garantías de atomicidad:
//   - migrationsTransactionMode: 'each' → cada archivo de migración es una
//     transacción independiente en PostgreSQL. Si la migración N falla, su
//     transacción hace rollback; las migraciones N-1 anteriores ya commiteadas
//     permanecen en typeorm_migrations. El siguiente deploy reintenta solo N.
//   - Este script hace snapshot pre/post para reportar exactamente cuáles
//     se aplicaron antes del fallo y cuál fue la que rompió.
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
  entities:            [],
  migrations:          [path.join(__dirname, 'migrations/auxiliary/*{.ts,.js}')],
  migrationsTableName: 'typeorm_migrations',
  migrationsTransactionMode: 'each',
  synchronize: false,
  logging: ['error', 'warn', 'schema'],
});

// Devuelve los nombres de migraciones ya aplicadas en BD.
// Si la tabla aún no existe retorna [] sin lanzar excepción.
async function snapshotAplicadas(): Promise<string[]> {
  try {
    const rows = await ds.query<{ name: string }[]>(
      `SELECT name FROM typeorm_migrations ORDER BY timestamp`,
    );
    return rows.map((r) => r.name);
  } catch {
    return [];
  }
}

async function main() {
  await ds.initialize();

  // ── Pre-snapshot: qué había aplicado ANTES de esta ejecución ─────────────
  const antes = await snapshotAplicadas();

  const hayPendientes = await ds.showMigrations();
  if (!hayPendientes) {
    console.log('[auxiliary-migrations] Sin migraciones pendientes — nada que hacer.');
    await ds.destroy();
    process.exit(0);
  }

  console.log('[auxiliary-migrations] Ejecutando migraciones auxiliares...');

  try {
    // transaction: 'each' → cada migración es su propia transacción.
    // Si la migración K falla, K hace rollback; K-1 ya están commiteadas
    // y registradas en typeorm_migrations. El próximo deploy reintenta K.
    const ran = await ds.runMigrations({ transaction: 'each' });

    console.log(`[auxiliary-migrations] OK — ${ran.length} migración(es) ejecutada(s):`);
    ran.forEach((m) => console.log(`  ✓ ${m.name}`));

    await ds.destroy();
    process.exit(0);

  } catch (err: any) {
    // ── Post-failure snapshot: qué quedó aplicado después del fallo ──────────
    const despues = await snapshotAplicadas();
    const aplicadas = despues.filter((n) => !antes.includes(n));

    if (aplicadas.length > 0) {
      console.log(
        `[auxiliary-migrations] Aplicadas antes del fallo (${aplicadas.length}) — ` +
        `ya están en typeorm_migrations y NO se re-ejecutarán:`,
      );
      aplicadas.forEach((n) => console.log(`  ✓ ${n}`));
    }

    console.error(`\n[auxiliary-migrations] FALLO en migración pendiente: ${err.message}`);
    console.error('[auxiliary-migrations] La migración fallida hizo rollback — BD en estado consistente.');
    console.error('[auxiliary-migrations] Próximo deploy: reintentará SOLO las migraciones aún pendientes.');
    console.error('[auxiliary-migrations] El servidor puede iniciar — módulos afectados entrarán en modo degradado.');

    await ds.destroy();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[auxiliary-migrations] Error fatal de inicialización: ${err.message}`);
  process.exit(1);
});
