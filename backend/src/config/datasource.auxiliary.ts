// DataSource para migraciones auxiliares (módulos opcionales: notificaciones, monitoreo, etc.)
// Uso CLI:  npm run migration:run:auxiliary
// Uso deploy: node dist/database/run-auxiliary-migrations.js

import * as dotenv from 'dotenv';
import * as path from 'path';
import { DataSource } from 'typeorm';

dotenv.config({ path: path.resolve(process.cwd(), '.env.production') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export default new DataSource({
  type: 'postgres',
  host:     process.env.DATABASE_HOST     || process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DATABASE_PORT || process.env.DB_PORT, 10) || 5432,
  database: process.env.DATABASE_NAME     || process.env.DB_NAME     || 'datafast_db',
  username: process.env.DATABASE_USER     || process.env.DB_USER     || 'datafast_db_user',
  password: process.env.DATABASE_PASSWORD || process.env.DB_PASSWORD,
  ssl: (process.env.DATABASE_SSL || process.env.DB_SSL) === 'true' ? { rejectUnauthorized: false } : false,
  entities:              [path.join(__dirname, '../**/*.entity{.ts,.js}')],
  migrations:            [path.join(__dirname, '../database/migrations/auxiliary/*{.ts,.js}')],
  migrationsTableName:   'typeorm_migrations',
  migrationsTransactionMode: 'each',
  synchronize: false,
  logging: true,
});
