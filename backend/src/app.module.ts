import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { CacheModule } from '@nestjs/cache-manager';
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';

import { appConfig, databaseConfig, redisConfig, jwtConfig, validationSchema } from './config';


import { JwtAuthGuard }          from './common/guards/jwt-auth.guard';
import { RolesGuard }            from './common/guards/roles.guard';
import { TransformInterceptor }  from './common/interceptors/transform.interceptor';
import { LoggingInterceptor }    from './common/interceptors/logging.interceptor';
import { TimeoutInterceptor }    from './common/interceptors/timeout.interceptor';
import { AuditInterceptor }      from './common/interceptors/audit.interceptor';
import { AllExceptionsFilter }   from './common/filters/http-exception.filter';

import { HealthModule } from './modules/health/health.module';
import { AuthModule }   from './modules/auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal:          true,
      envFilePath:       ['.env.production', '.env.local', '.env'],
      load:              [appConfig, databaseConfig, redisConfig, jwtConfig],
      validationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
      expandVariables:   true,
    }),

    TypeOrmModule.forRootAsync({
      imports:    [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type:                 'postgres',
        host:                 config.get('database.host'),
        port:                 config.get<number>('database.port'),
        database:             config.get('database.database'),
        username:             config.get('database.username'),
        password:             config.get('database.password'),
        ssl:                  config.get('database.ssl'),
        entities:             [__dirname + '/**/*.entity{.ts,.js}'],
        migrations:           [__dirname + '/database/migrations/*{.ts,.js}'],
        migrationsTableName:  'typeorm_migrations',
        migrationsRun:        false,
        synchronize:          false,
        logging:              false,
        extra:                { max: 20, min: 2, idleTimeoutMillis: 30000 },
        retryAttempts:        10,
        retryDelay:           3000,
        autoLoadEntities:     true,
      }),
      inject: [ConfigService],
    }),
    CacheModule.registerAsync({
      isGlobal:   true,
      imports:    [ConfigModule],
      useFactory: (config: ConfigService) => ({
        ttl: 300_000,
      }),
      inject: [ConfigService],
    }),
    BullModule.forRootAsync({
      imports:    [ConfigModule],
      useFactory: (config: ConfigService) => ({
        redis: {
          host:                  config.get('redis.host') || 'localhost',
          port:                  config.get<number>('redis.port') || 6379,
          password:              config.get('redis.password'),
          db:                    2,
          maxRetriesPerRequest:  null,
          enableReadyCheck:      false,
        },
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail:     500,
          attempts:         3,
          backoff:          { type: 'exponential', delay: 5000 },
        },
      }),
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      imports:    [ConfigModule],
      useFactory: () => ({
        throttlers: [
          { name: 'short',  ttl: 1_000,     limit: 10   },
          { name: 'medium', ttl: 60_000,    limit: 100  },
          { name: 'long',   ttl: 3_600_000, limit: 1000 },
        ],
      }),
      inject: [ConfigService],
    }),
    HealthModule,
    AuthModule,
  ],
  providers: [
    { provide: APP_GUARD,       useClass: JwtAuthGuard },
    { provide: APP_GUARD,       useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useFactory: () => new TimeoutInterceptor(30000) },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_FILTER,      useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
