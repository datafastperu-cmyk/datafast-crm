import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { CacheModule } from '@nestjs/cache-manager';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';

import { appConfig, databaseConfig, redisConfig, jwtConfig, validationSchema } from './config';


import { ModuleHealthModule }    from './common/module-health.module';
import { RedisLockModule }      from './common/redis/redis.module';
import { LicenciaGuard }         from './modules/licencia/licencia.guard';
import { JwtAuthGuard }          from './common/guards/jwt-auth.guard';
import { RolesGuard }            from './common/guards/roles.guard';
import { TransformInterceptor }  from './common/interceptors/transform.interceptor';
import { LoggingInterceptor }    from './common/interceptors/logging.interceptor';
import { TimeoutInterceptor }    from './common/interceptors/timeout.interceptor';
import { AuditInterceptor }      from './common/interceptors/audit.interceptor';
import { AllExceptionsFilter }   from './common/filters/http-exception.filter';
import { QueuePauseService }     from './common/services/queue-pause.service';
import { QUEUES }                from './modules/workers/workers.constants';
import { VELOCIDAD_QUEUE }       from './modules/mikrotik/velocidad.worker';

import { LicenciaModule }        from './modules/licencia/licencia.module';
import { HealthModule }           from './modules/health/health.module';
import { AuthModule }             from './modules/auth/auth.module';
import { InstallModule }          from './modules/install/install.module';
import { UsuariosModule }         from './modules/usuarios/usuarios.module';
import { SistemaModule }          from './modules/sistema/sistema.module';
import { ClientesModule }         from './modules/clientes/clientes.module';
import { ContratosModule }        from './modules/contratos/contratos.module';
import { FacturacionModule }      from './modules/facturacion/facturacion.module';
import { PagosModule }            from './modules/pagos/pagos.module';
import { MonitoreoModule }        from './modules/monitoreo/monitoreo.module';
import { PlanesModule }           from './modules/planes/planes.module';
import { AprovisionamientoModule } from './modules/aprovisionamiento/aprovisionamiento.module';
import { MikrotikModule }         from './modules/mikrotik/mikrotik.module';
import { SmartoltModule }         from './modules/smartolt/smartolt.module';
import { XuiModule }              from './modules/xui/xui.module';
import { WorkersModule }          from './modules/workers/workers.module';
import { OpenvpnModule }          from './modules/openvpn/openvpn.module';
import { PlantillasModule }       from './modules/plantillas/plantillas.module';
import { DashboardModule }        from './modules/dashboard/dashboard.module';
import { BackupModule }           from './modules/backup/backup.module';
import { AuditoriaModule }        from './modules/auditoria/auditoria.module';
import { ZonasModule }            from './modules/zonas/zonas.module';
import { GoogleIntegrationModule } from './modules/google-integration/google-integration.module';
import { ConfiguracionModule }    from './modules/config/config.module';
import { MantenimientoModule }    from './modules/mantenimiento/mantenimiento.module';
import { TicketsModule }          from './modules/tickets/tickets.module';
import { ReportesModule }         from './modules/reportes/reportes.module';
import { WebhooksModule }         from './modules/webhooks/webhooks.module';
import { CrmNativoModule }        from './modules/crm-nativo/crm-nativo.module';
import { OltNativoModule }        from './modules/olt-nativo/olt-nativo.module';
import { Tr069Module }            from './modules/tr069/tr069.module';
import { FinanzasOpexModule }          from './modules/finanzas-opex/finanzas-opex.module';
import { ProyectosInversionModule }    from './modules/proyectos-inversion/proyectos-inversion.module';
import { MensajeriaModule }            from './modules/mensajeria/mensajeria.module';
import { SchemaGuardModule }           from './modules/schema-guard/schema-guard.module';
import { SagasModule }                from './modules/sagas/sagas.module';
import { ReconciliadorModule }        from './modules/reconciliador/reconciliador.module';
import { PromesasPagoModule }         from './modules/promesas-pago/promesas-pago.module';

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
        migrations:              [__dirname + '/database/migrations/core/*{.ts,.js}'],
        migrationsTableName:     'typeorm_migrations',
        migrationsRun:           true,
        migrationsTransactionMode: 'each',
        synchronize:          false,
        logging:              false,
        extra:                {
          max: parseInt(process.env.DB_POOL_MAX, 10) || 15,
          min: parseInt(process.env.DB_POOL_MIN, 10) || 2,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
        },
        retryAttempts:        10,
        retryDelay:           3000,
        autoLoadEntities:     true,
      }),
      inject: [ConfigService],
    }),
    CacheModule.registerAsync({
      isGlobal:   true,
      imports:    [ConfigModule],
      useFactory: async (config: ConfigService) => {
        const { redisStore } = await import('cache-manager-ioredis-yet');
        return {
          store: await redisStore({
            host:     config.get<string>('redis.host') || 'localhost',
            port:     config.get<number>('redis.port') || 6379,
            password: config.get<string>('redis.password') || undefined,
            db:       0,
            ttl:      300_000, // 5 minutos en ms (cache-manager v5 usa ms)
          }),
        };
      },
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
    BullModule.registerQueue(
      { name: QUEUES.COBRANZA },
      { name: QUEUES.FACTURACION },
      { name: QUEUES.GOOGLE_SYNC },
      { name: VELOCIDAD_QUEUE },
    ),
    EventEmitterModule.forRoot({
      wildcard:     false,
      delimiter:    '.',
      maxListeners: 30,
      ignoreErrors: false,
    }),
    // Siempre registrado: SchedulerRegistry debe existir en todos los procesos
    // (varios servicios que la inyectan también se cargan en datafast-api-core,
    // no solo en el worker). Registrar el módulo no ejecuta ningún job por sí
    // solo — cada servicio decide con RUN_CRONS si realmente agrega el cron.
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
    ModuleHealthModule,  // global — inyectable en todos los módulos sin importar
    RedisLockModule,     // global — locks distribuidos y CB para todos los módulos
    LicenciaModule,
    HealthModule,
    AuthModule,
    InstallModule,
    UsuariosModule,
    SistemaModule,
    ClientesModule,
    ContratosModule,
    FacturacionModule,
    PagosModule,
    MonitoreoModule,
    PlanesModule,
    AprovisionamientoModule,
    MikrotikModule,
    SmartoltModule,
    XuiModule,
    WorkersModule,
    OpenvpnModule,
    PlantillasModule,
    DashboardModule,
    BackupModule,
    AuditoriaModule,
    ZonasModule,
    GoogleIntegrationModule,
    ConfiguracionModule,
    MantenimientoModule,
    TicketsModule,
    ReportesModule,
    WebhooksModule,
    CrmNativoModule,
    OltNativoModule,
    Tr069Module,
    FinanzasOpexModule,
    ProyectosInversionModule,
    MensajeriaModule,
    SchemaGuardModule,
    SagasModule,
    ReconciliadorModule,
    PromesasPagoModule,
  ],
  providers: [
    { provide: APP_GUARD,       useClass: LicenciaGuard },   // ← PRIMERO: bloquea sin licencia
    { provide: APP_GUARD,       useClass: JwtAuthGuard },
    { provide: APP_GUARD,       useClass: RolesGuard },
    { provide: APP_GUARD,       useClass: ThrottlerGuard },  // ← Rate limiting global
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useFactory: () => new TimeoutInterceptor(30000) },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_FILTER,      useClass: AllExceptionsFilter },
    QueuePauseService,
  ],
})
export class AppModule {}
