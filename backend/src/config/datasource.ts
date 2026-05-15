// ─── DataSource para CLI de TypeORM (migraciones) ─────────────
// Uso: npm run migration:generate -- src/database/migrations/NombreMigracion
// Uso: npm run migration:run
//
// Este archivo es SOLO para el CLI de TypeORM, no para la app.

import 'dotenv/config';
import { DataSource } from 'typeorm';
import * as path from 'path';

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  database: process.env.DB_NAME || 'datafast',
  username: process.env.DB_USER || 'datafast',
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  entities: [path.join(__dirname, '../**/*.entity{.ts,.js}')],
  migrations: [path.join(__dirname, '../database/migrations/*{.ts,.js}')],
  migrationsTableName: 'typeorm_migrations',
  synchronize: false,
  logging: true,
});
