// ─── DataSource de INSTALACIÓN DESDE CERO ─────────────────────
//
// Uso:  npm run migration:run:all      (base vacía → esquema completo)
//
// Por qué existe (2026-07-28): el deploy incremental corre las migraciones en dos
// bloques —primero `core`, después `auxiliary`— porque un fallo en los módulos
// opcionales (notificaciones, monitoreo) no debe tumbar el despliegue: arrancan
// degradados y el servidor anterior sigue vivo. Ese diseño es correcto PARA UN DEPLOY.
//
// Pero rompe la instalación en un servidor nuevo. `AddAntenaApIdToContratos` (core,
// timestamp 1784500000000) declara una FK contra `dispositivos_monitoreo`, que crea
// `CreateDispositivosMonitoreo` (auxiliary, timestamp 1784200000000). Los timestamps son
// correctos —auxiliary va antes— pero al ejecutarse en bloques separados, con core
// primero, la tabla todavía no existe y la migración aborta. Resultado: hasta hoy NO
// existía forma de levantar el ERP en un VPS nuevo, lo que contradice de frente la
// directriz de portabilidad multi-VPS.
//
// La corrección es mínima porque el problema nunca fue el orden de los timestamps: ambos
// conjuntos van a la MISMA base y comparten la MISMA tabla `typeorm_migrations`. Basta
// con declarar los dos directorios y dejar que TypeORM los ordene por timestamp, que es
// lo que hace de forma nativa. No se toca el flujo de deploy incremental.
//
// Regla: instalación nueva → `migration:run:all`. Deploy incremental → como está.

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

  entities: [path.join(__dirname, '../**/*.entity{.ts,.js}')],

  // Los DOS conjuntos. TypeORM los ordena por el timestamp del nombre de clase, así que
  // la intercalación es automática y respeta las dependencias entre ambos.
  migrations: [
    path.join(__dirname, '../database/migrations/core/*{.ts,.js}'),
    path.join(__dirname, '../database/migrations/auxiliary/*{.ts,.js}'),
  ],

  // Misma tabla que los otros dos datasources: una instalación completa y una serie de
  // deploys incrementales tienen que converger al mismo estado registrado.
  migrationsTableName: 'typeorm_migrations',
  migrationsTransactionMode: 'each',
  synchronize: false,
  logging: true,
});
