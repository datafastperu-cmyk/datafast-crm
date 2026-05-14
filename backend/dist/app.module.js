"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const typeorm_1 = require("@nestjs/typeorm");
const bull_1 = require("@nestjs/bull");
const schedule_1 = require("@nestjs/schedule");
const throttler_1 = require("@nestjs/throttler");
const cache_manager_1 = require("@nestjs/cache-manager");
const core_1 = require("@nestjs/core");
const config_2 = require("./config");
const jwt_auth_guard_1 = require("./common/guards/jwt-auth.guard");
const roles_guard_1 = require("./common/guards/roles.guard");
const transform_interceptor_1 = require("./common/interceptors/transform.interceptor");
const logging_interceptor_1 = require("./common/interceptors/logging.interceptor");
const timeout_interceptor_1 = require("./common/interceptors/timeout.interceptor");
const audit_interceptor_1 = require("./common/interceptors/audit.interceptor");
const http_exception_filter_1 = require("./common/filters/http-exception.filter");
const health_module_1 = require("./modules/health/health.module");
const auth_module_1 = require("./modules/auth/auth.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                envFilePath: ['.env.production', '.env.local', '.env'],
                load: [config_2.appConfig, config_2.databaseConfig, config_2.redisConfig, config_2.jwtConfig],
                validationSchema: config_2.validationSchema,
                validationOptions: { allowUnknown: true, abortEarly: false },
                expandVariables: true,
            }),
            typeorm_1.TypeOrmModule.forRootAsync({
                imports: [config_1.ConfigModule],
                useFactory: (config) => ({
                    type: 'postgres',
                    host: config.get('database.host'),
                    port: config.get('database.port'),
                    database: config.get('database.database'),
                    username: config.get('database.username'),
                    password: config.get('database.password'),
                    ssl: config.get('database.ssl'),
                    entities: [__dirname + '/**/*.entity{.ts,.js}'],
                    migrations: [__dirname + '/database/migrations/*{.ts,.js}'],
                    migrationsTableName: 'typeorm_migrations',
                    migrationsRun: false,
                    synchronize: false,
                    logging: false,
                    extra: { max: 20, min: 2, idleTimeoutMillis: 30000 },
                    retryAttempts: 10,
                    retryDelay: 3000,
                    autoLoadEntities: true,
                }),
                inject: [config_1.ConfigService],
            }),
            cache_manager_1.CacheModule.registerAsync({
                isGlobal: true,
                imports: [config_1.ConfigModule],
                useFactory: (config) => ({
                    ttl: 300_000,
                }),
                inject: [config_1.ConfigService],
            }),
            bull_1.BullModule.forRootAsync({
                imports: [config_1.ConfigModule],
                useFactory: (config) => ({
                    redis: {
                        host: config.get('redis.host') || 'localhost',
                        port: config.get('redis.port') || 6379,
                        password: config.get('redis.password'),
                        db: 2,
                        maxRetriesPerRequest: null,
                        enableReadyCheck: false,
                    },
                    defaultJobOptions: {
                        removeOnComplete: 100,
                        removeOnFail: 500,
                        attempts: 3,
                        backoff: { type: 'exponential', delay: 5000 },
                    },
                }),
                inject: [config_1.ConfigService],
            }),
            schedule_1.ScheduleModule.forRoot(),
            throttler_1.ThrottlerModule.forRootAsync({
                imports: [config_1.ConfigModule],
                useFactory: () => ({
                    throttlers: [
                        { name: 'short', ttl: 1_000, limit: 10 },
                        { name: 'medium', ttl: 60_000, limit: 100 },
                        { name: 'long', ttl: 3_600_000, limit: 1000 },
                    ],
                }),
                inject: [config_1.ConfigService],
            }),
            health_module_1.HealthModule,
            auth_module_1.AuthModule,
        ],
        providers: [
            { provide: core_1.APP_GUARD, useClass: jwt_auth_guard_1.JwtAuthGuard },
            { provide: core_1.APP_GUARD, useClass: roles_guard_1.RolesGuard },
            { provide: core_1.APP_INTERCEPTOR, useClass: logging_interceptor_1.LoggingInterceptor },
            { provide: core_1.APP_INTERCEPTOR, useFactory: () => new timeout_interceptor_1.TimeoutInterceptor(30000) },
            { provide: core_1.APP_INTERCEPTOR, useClass: audit_interceptor_1.AuditInterceptor },
            { provide: core_1.APP_INTERCEPTOR, useClass: transform_interceptor_1.TransformInterceptor },
            { provide: core_1.APP_FILTER, useClass: http_exception_filter_1.AllExceptionsFilter },
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map