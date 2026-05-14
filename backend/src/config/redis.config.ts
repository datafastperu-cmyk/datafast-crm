import { registerAs } from '@nestjs/config';

export const redisConfig = registerAs('redis', () => ({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  password: process.env.REDIS_PASSWORD,

  // Bases de datos Redis separadas por función
  // DB 0: Cache general y sesiones
  // DB 1: Cache TypeORM queries
  // DB 2: Bull queues
  // DB 3: Rate limiting
  // DB 4: WebSocket rooms/state
  db: {
    cache: 0,
    typeorm: 1,
    queues: 2,
    rateLimit: 3,
    websocket: 4,
  },

  // Opciones de conexión
  connectTimeout: 10000,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,

  // TTL por defecto para cache (segundos)
  defaultTtl: 300, // 5 minutos

  // Prefijos de keys por tipo
  keyPrefix: {
    session: 'sess:',
    cache: 'cache:',
    rateLimit: 'rl:',
    blacklist: 'jwt_bl:',  // Tokens JWT invalidados (logout)
    otp: 'otp:',
  },
}));

// ─── Opciones IORedis para BullMQ/Bull ────────────────────────
export const bullRedisOptions = {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD,
    db: 2, // DB dedicada para queues
    maxRetriesPerRequest: null, // Requerido por Bull
    enableReadyCheck: false,    // Requerido por Bull
  },
};
