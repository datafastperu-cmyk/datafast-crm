import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, VersioningType, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import * as helmet from 'helmet';
import * as compression from 'compression';
import * as path from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';
import { winstonConfig } from './config/logger.config';

async function bootstrap() {
  // ── Crear la aplicación ──────────────────────────────────────
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: winstonConfig,      // Reemplazar logger de Nest con Winston
    bufferLogs: true,           // Bufferar logs hasta que el logger esté listo
    rawBody: true,              // Necesario para verificar webhooks (MercadoPago, WhatsApp)
  });

  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  const port = config.get<number>('app.port') || 3000;
  const env = config.get<string>('app.env') || 'development';

  // ── Prefijo global de la API ───────────────────────────────
  app.setGlobalPrefix('api', {
    exclude: ['health', 'health/live', 'health/ready', 'status'], // Sin prefijo
  });

  // ── Versionado de la API ───────────────────────────────────
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
    prefix: 'v',
    // Resultado: /api/v1/clientes, /api/v1/facturas, etc.
  });

  // ── CORS ─────────────────────────────────────────────────────
  app.enableCors({
    // JWT en Authorization header es la capa de seguridad real.
    // Aceptamos cualquier origen para que funcione en cualquier dominio
    // sin reconfigurar por cada cliente (multi-tenant).
    origin: true,
    credentials: true,           // Permitir cookies
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-ID',
      'X-Portal-Request',
    ],
    exposedHeaders: ['X-Total-Count', 'X-Request-ID'],
  });

  // ── Helmet — Headers de seguridad HTTP ───────────────────────
  app.use(
    (helmet as any).default({
      contentSecurityPolicy: env === 'production',  // Solo en producción
      crossOriginEmbedderPolicy: false,
    }),
  );

  // ── Compresión gzip ───────────────────────────────────────────
  app.use(compression());

  // ── Trust proxy (Nginx delante de la app) ────────────────────
  app.set('trust proxy', 1);

  // ── Archivos estáticos (uploads) ─────────────────────────────
  const uploadDir = config.get<string>('app.uploadDir') || '/app/uploads';
  app.useStaticAssets(uploadDir, {
    prefix: '/uploads/',
    // Solo GET — no se pueden listar directorios
    dotfiles: 'deny',
  });

  // ── Media CRM WhatsApp (/media/uuid.jpg, /media/uuid.ogg) ────
  app.useStaticAssets(path.join(process.cwd(), 'public'), {
    prefix: '/media/',
    dotfiles: 'deny',
  });

  // ── WebSocket con Socket.IO ───────────────────────────────────
  app.useWebSocketAdapter(new IoAdapter(app));

  // ── Validación global de DTOs ─────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,              // Eliminar campos no definidos en el DTO
      forbidNonWhitelisted: false,  // No fallar si vienen campos extra (más permisivo)
      transform: true,              // Transformar tipos automáticamente (string → number)
      transformOptions: {
        enableImplicitConversion: true, // Convertir tipos primitivos automáticamente
      },
      disableErrorMessages: false, // Siempre mostrar detalles de validación
      stopAtFirstError: false,      // Mostrar todos los errores, no solo el primero
    }),
  );

  // ── Swagger — Documentación de la API ────────────────────────
  if (env !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('CRM ISP DATAFAST — API')
      .setDescription(
        `API REST del sistema ERP/CRM para proveedores de internet (FTTH/WISP).

**Autenticación**: Bearer JWT — obtener token en \`POST /api/v1/auth/login\`

**Versión**: v1 | **Timezone**: America/Lima | **Moneda**: PEN (S/)`,
      )
      .setVersion('1.0.0')
      .setContact('Soporte DATAFAST', '', 'soporte@datafast.pe')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', in: 'header' },
        'JWT',
      )
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

    const document = SwaggerModule.createDocument(app, swaggerConfig, {
      operationIdFactory: (controllerKey, methodKey) => methodKey,
      deepScanRoutes: true,
    });

    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,  // Mantener el token entre recargas
        docExpansion: 'none',
        filter: true,
        showRequestDuration: true,
        tryItOutEnabled: true,
      },
      customSiteTitle: 'CRM ISP DATAFAST — API Docs',
      customCss: '.swagger-ui .topbar { background-color: #1a1a2e; }',
    });

    logger.log(`Swagger disponible en: http://localhost:${port}/api/docs`);
  }

  // ── Manejo de señales del sistema (graceful shutdown) ─────────
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

  // ── Arrancar el servidor ──────────────────────────────────────
  await app.listen(port, '0.0.0.0');

  logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.log(`  CRM ISP DATAFAST — Backend`);
  logger.log(`  Entorno:   ${env.toUpperCase()}`);
  logger.log(`  URL:       http://localhost:${port}`);
  logger.log(`  API:       http://localhost:${port}/api/v1`);
  logger.log(`  Health:    http://localhost:${port}/health`);
  if (env !== 'production') {
    logger.log(`  Swagger:   http://localhost:${port}/api/docs`);
  }
  logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Señal requerida por PM2 wait_ready: true
  if (process.send) process.send('ready');
}

// Prevent crash loops from:
// 1. Winston transport "write after end" race during shutdown
// 2. RouterOS socket timeouts that escape MonitoreoWorker error handling
process.on('uncaughtException', (err) => {
  const msg = (err as any).message ?? '';
  if (msg === 'write after end') return;
  if (msg.includes('Timed out after') || (err as any).constructor?.name === 'RosException') return;
  console.error('Uncaught exception:', msg);
  process.exit(1);
});

bootstrap().catch((error) => {
  console.error('Error fatal al arrancar la aplicación:', error);
  process.exit(1);
});
