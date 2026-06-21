import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_LOCK_CLIENT, RedisLockService } from './redis-lock.service';

// DB 5 — locks distribuidos y circuit breaker (DBs 0-4 ya usadas por cache/typeorm/bull/throttler/ws)
const REDIS_LOCK_DB = 5;

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_LOCK_CLIENT,
      useFactory: (config: ConfigService): Redis => {
        const client = new Redis({
          host:                 config.get<string>('redis.host') || 'localhost',
          port:                 config.get<number>('redis.port') || 6379,
          password:             config.get<string>('redis.password') || undefined,
          db:                   REDIS_LOCK_DB,
          lazyConnect:          false,
          enableReadyCheck:     true,
          maxRetriesPerRequest: 3,
          connectTimeout:       10_000,
          keyPrefix:            'lock:',
        });

        client.on('error', (err) => {
          // No crashear el backend por Redis caído — el lock fallará gracefully
          console.error('[RedisLock] Conexión perdida:', err.message);
        });

        return client;
      },
      inject: [ConfigService],
    },
    RedisLockService,
  ],
  exports: [REDIS_LOCK_CLIENT, RedisLockService],
})
export class RedisLockModule {}
