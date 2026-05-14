"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const swagger_1 = require("@nestjs/swagger");
const platform_socket_io_1 = require("@nestjs/platform-socket.io");
const helmet = require("helmet");
const compression = require("compression");
const app_module_1 = require("./app.module");
const logger_config_1 = require("./config/logger.config");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, {
        logger: logger_config_1.winstonConfig,
        bufferLogs: true,
        rawBody: true,
    });
    const config = app.get(config_1.ConfigService);
    const logger = new common_1.Logger('Bootstrap');
    const port = config.get('app.port') || 3000;
    const env = config.get('app.env') || 'development';
    const frontendUrl = config.get('app.frontendUrl');
    const allowedOrigins = config.get('app.allowedOrigins') || [];
    app.setGlobalPrefix('api', {
        exclude: ['health', 'health/live', 'health/ready', 'status'],
    });
    app.enableVersioning({
        type: common_1.VersioningType.URI,
        defaultVersion: '1',
        prefix: 'v',
    });
    app.enableCors({
        origin: env === 'development'
            ? true
            : (origin, callback) => {
                const origins = [frontendUrl, ...allowedOrigins].filter(Boolean);
                if (!origin || origins.includes(origin)) {
                    callback(null, true);
                }
                else {
                    callback(new Error(`Origen CORS no permitido: ${origin}`));
                }
            },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: [
            'Content-Type',
            'Authorization',
            'X-Request-ID',
            'X-Portal-Request',
        ],
        exposedHeaders: ['X-Total-Count', 'X-Request-ID'],
    });
    app.use(helmet.default({
        contentSecurityPolicy: env === 'production',
        crossOriginEmbedderPolicy: false,
    }));
    app.use(compression());
    app.set('trust proxy', 1);
    const uploadDir = config.get('app.uploadDir') || '/app/uploads';
    app.useStaticAssets(uploadDir, {
        prefix: '/uploads/',
        dotfiles: 'deny',
    });
    app.useWebSocketAdapter(new platform_socket_io_1.IoAdapter(app));
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: false,
        transform: true,
        transformOptions: {
            enableImplicitConversion: true,
        },
        disableErrorMessages: env === 'production',
        stopAtFirstError: false,
    }));
    if (env !== 'production') {
        const swaggerConfig = new swagger_1.DocumentBuilder()
            .setTitle('FibraNet ISP ERP — API')
            .setDescription(`API REST del sistema ERP/CRM para proveedores de internet (FTTH/WISP).

**Autenticación**: Bearer JWT — obtener token en \`POST /api/v1/auth/login\`

**Versión**: v1 | **Timezone**: America/Lima | **Moneda**: PEN (S/)`)
            .setVersion('1.0.0')
            .setContact('Soporte FibraNet', '', 'soporte@fibranet.pe')
            .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT', in: 'header' }, 'JWT')
            .addTag('Auth', 'Autenticación y gestión de sesiones')
            .addTag('Clientes', 'Gestión de clientes ISP')
            .addTag('Contratos', 'Contratos de servicio')
            .addTag('Facturación', 'Facturas y boletas')
            .addTag('Pagos', 'Registro y conciliación de pagos')
            .addTag('Planes', 'Planes de servicio')
            .addTag('Redes', 'Gestión IPv4 y pools')
            .addTag('Mikrotik', 'Integración RouterOS')
            .addTag('FTTH', 'OLT, ONUs y aprovisionamiento')
            .addTag('Monitoreo', 'Nodos, antenas y alertas')
            .addTag('Notificaciones', 'WhatsApp, Email, SMS')
            .addTag('Tickets', 'Soporte técnico')
            .addTag('Portal', 'API del portal del cliente')
            .addTag('Reportes', 'Reportes y exportaciones')
            .addTag('Usuarios', 'Usuarios y roles del sistema')
            .addTag('Sistema', 'Health checks y estado del sistema')
            .addServer('http://localhost:3000', 'Desarrollo local')
            .addServer('https://app.tudominio.com', 'Producción')
            .build();
        const document = swagger_1.SwaggerModule.createDocument(app, swaggerConfig, {
            operationIdFactory: (controllerKey, methodKey) => methodKey,
            deepScanRoutes: true,
        });
        swagger_1.SwaggerModule.setup('api/docs', app, document, {
            swaggerOptions: {
                persistAuthorization: true,
                docExpansion: 'none',
                filter: true,
                showRequestDuration: true,
                tryItOutEnabled: true,
            },
            customSiteTitle: 'FibraNet ISP — API Docs',
            customCss: '.swagger-ui .topbar { background-color: #1a1a2e; }',
        });
        logger.log(`Swagger disponible en: http://localhost:${port}/api/docs`);
    }
    app.enableShutdownHooks();
    process.on('SIGTERM', async () => {
        logger.log('SIGTERM recibido — cerrando servidor gracefully...');
        await app.close();
        process.exit(0);
    });
    process.on('SIGINT', async () => {
        logger.log('SIGINT recibido — cerrando servidor...');
        await app.close();
        process.exit(0);
    });
    await app.listen(port, '0.0.0.0');
    logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.log(`  FibraNet ISP ERP — Backend`);
    logger.log(`  Entorno:   ${env.toUpperCase()}`);
    logger.log(`  URL:       http://localhost:${port}`);
    logger.log(`  API:       http://localhost:${port}/api/v1`);
    logger.log(`  Health:    http://localhost:${port}/health`);
    if (env !== 'production') {
        logger.log(`  Swagger:   http://localhost:${port}/api/docs`);
    }
    logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}
bootstrap().catch((error) => {
    console.error('Error fatal al arrancar la aplicación:', error);
    process.exit(1);
});
//# sourceMappingURL=main.js.map