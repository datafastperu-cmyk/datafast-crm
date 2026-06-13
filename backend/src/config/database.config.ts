import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export const databaseConfig = registerAs('database', (): TypeOrmModuleOptions => ({
  type: 'postgres',
  host:     process.env.DATABASE_HOST     || process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DATABASE_PORT || process.env.DB_PORT, 10) || 5432,
  database: process.env.DATABASE_NAME     || process.env.DB_NAME     || 'datafast_db',
  username: process.env.DATABASE_USER     || process.env.DB_USER     || 'datafast_db_user',
  password: process.env.DATABASE_PASSWORD || process.env.DB_PASSWORD,
  ssl: (process.env.DATABASE_SSL || process.env.DB_SSL) === 'true'
    ? { rejectUnauthorized: false }
    : false,

  // Auto-detectar todas las entidades del proyecto
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],

  // Migraciones
  migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
  migrationsTableName: 'typeorm_migrations',
  migrationsRun: true,

  // NUNCA usar synchronize en producción — usar migraciones
  synchronize: false,

  // Logging de queries en desarrollo
  logging: process.env.NODE_ENV === 'development'
    ? ['query', 'error', 'warn', 'schema']
    : ['error', 'warn'],

  // Opciones de pool de conexiones
  extra: {
    // Pool size según carga esperada
    max: parseInt(process.env.DB_POOL_MAX, 10) || 20,
    min: parseInt(process.env.DB_POOL_MIN, 10) || 2,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    // Statement timeout (prevenir queries lentas)
    statement_timeout: 30000,
  },

  // Retry en caso de fallo de conexión al inicio
  retryAttempts: 10,
  retryDelay: 3000,

  // Cache de queries con Redis (mejorar performance)
  cache: {
    type: 'ioredis',
    options: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT, 10) || 6379,
      password: process.env.REDIS_PASSWORD,
      db: 1, // DB separada para cache de TypeORM
    },
    duration: 30000, // 30 segundos de cache por defecto
  },
}));
