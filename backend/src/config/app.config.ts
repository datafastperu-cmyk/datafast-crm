import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';

// ─── Schema de validación de variables de entorno ──────────────
// El sistema valida en el arranque que todas las variables
// obligatorias estén presentes con los tipos correctos.
export const validationSchema = Joi.object({
  // App
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test', 'staging')
    .default('development'),
  PORT: Joi.number().default(4000),
  TZ: Joi.string().default('America/Lima'),
  APP_URL: Joi.string().uri().optional(),
  FRONTEND_URL: Joi.string().uri().required(),
  ALLOWED_ORIGINS: Joi.string().required(),

  // Database — acepta tanto DB_* como DATABASE_* (alias)
  DB_HOST:      Joi.string().optional(),
  DB_PORT:      Joi.number().default(5432),
  DB_NAME:      Joi.string().optional(),
  DB_USER:      Joi.string().optional(),
  DB_PASSWORD:  Joi.string().optional(),
  DB_SSL:       Joi.boolean().default(false),
  DATABASE_HOST:     Joi.string().optional(),
  DATABASE_PORT:     Joi.number().default(5432),
  DATABASE_NAME:     Joi.string().optional(),
  DATABASE_USER:     Joi.string().optional(),
  DATABASE_PASSWORD: Joi.string().optional(),
  DATABASE_SSL:      Joi.boolean().default(false),

  // Redis
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().required(),

  // JWT
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  // Encryption
  ENCRYPTION_KEY: Joi.string().length(64).required(), // 32 bytes hex

  // Opcionales (integraciones externas) — permiten string vacío
  RENIEC_API_URL: Joi.string().uri().allow('').optional(),
  RENIEC_API_TOKEN: Joi.string().allow('').optional(),
  GOOGLE_MAPS_API_KEY: Joi.string().allow('').optional(),
  SMARTOLT_URL: Joi.string().uri().allow('').optional(),
  SMARTOLT_TOKEN: Joi.string().allow('').optional(),
  MP_ACCESS_TOKEN: Joi.string().allow('').optional(),
  MP_WEBHOOK_SECRET: Joi.string().allow('').optional(),
  MP_SANDBOX: Joi.boolean().default(true),
  WHATSAPP_TOKEN: Joi.string().allow('').optional(),
  WHATSAPP_PHONE_ID: Joi.string().allow('').optional(),
  WHATSAPP_VERIFY_TOKEN: Joi.string().allow('').optional(),
  SMTP_HOST: Joi.string().allow('').optional(),
  SMTP_PORT: Joi.number().default(587),
  SMTP_USER: Joi.string().allow('').optional(),
  SMTP_PASS: Joi.string().allow('').optional(),
  SMTP_FROM_NAME: Joi.string().default('CRM ISP DATAFAST'),
  SMTP_FROM_EMAIL: Joi.string().email().allow('').optional(),
  TWILIO_ACCOUNT_SID: Joi.string().allow('').optional(),
  TWILIO_AUTH_TOKEN: Joi.string().allow('').optional(),
  TWILIO_PHONE_NUMBER: Joi.string().allow('').optional(),
  TELEGRAM_BOT_TOKEN: Joi.string().allow('').optional(),

  // Negocio
  BILLING_DAY: Joi.number().min(1).max(28).default(1),
  GRACE_DAYS: Joi.number().min(0).max(30).default(5),
  IGV_RATE: Joi.number().default(0.18),
  CURRENCY: Joi.string().default('PEN'),
  CURRENCY_SYMBOL: Joi.string().default('S/'),

  // Monitoreo
  MONITORING_PING_INTERVAL: Joi.number().default(30),
  MONITORING_SNMP_INTERVAL: Joi.number().default(60),
  ALERT_LATENCY_THRESHOLD_MS: Joi.number().default(100),
  ALERT_PACKET_LOSS_THRESHOLD: Joi.number().default(10),

  // Licenciamiento
  LICENSE_KEY:       Joi.string().allow('').optional(),
  HEARTBEAT_SECRET:  Joi.string().min(16).allow('').optional(),

  // Logging
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'debug', 'verbose')
    .default('info'),
  LOG_DIR: Joi.string().default('/app/logs'),

  // Uploads
  UPLOAD_DIR: Joi.string().default('/app/uploads'),
  MAX_FILE_SIZE_MB: Joi.number().default(10),
});

// ─── Configuración tipada de la aplicación ────────────────────
export const appConfig = registerAs('app', () => ({
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,
  url: process.env.APP_URL,
  frontendUrl: process.env.FRONTEND_URL,
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || [],
  timezone: process.env.TZ || 'America/Lima',
  uploadDir: process.env.UPLOAD_DIR || '/app/uploads',
  maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 10,
  logLevel: process.env.LOG_LEVEL || 'info',
  logDir: process.env.LOG_DIR || '/app/logs',
  encryptionKey: process.env.ENCRYPTION_KEY,

  // Configuración de negocio
  billing: {
    day: parseInt(process.env.BILLING_DAY, 10) || 1,
    graceDays: parseInt(process.env.GRACE_DAYS, 10) || 5,
    igvRate: parseFloat(process.env.IGV_RATE) || 0.18,
    currency: process.env.CURRENCY || 'PEN',
    currencySymbol: process.env.CURRENCY_SYMBOL || 'S/',
  },

  // Monitoreo
  monitoring: {
    pingInterval: parseInt(process.env.MONITORING_PING_INTERVAL, 10) || 30,
    snmpInterval: parseInt(process.env.MONITORING_SNMP_INTERVAL, 10) || 60,
    latencyThreshold: parseInt(process.env.ALERT_LATENCY_THRESHOLD_MS, 10) || 100,
    packetLossThreshold: parseInt(process.env.ALERT_PACKET_LOSS_THRESHOLD, 10) || 10,
  },

  // RENIEC
  reniec: {
    url: process.env.RENIEC_API_URL,
    token: process.env.RENIEC_API_TOKEN,
  },

  // Google Maps
  googleMapsKey: process.env.GOOGLE_MAPS_API_KEY,

  // SmartOLT
  smartolt: {
    url: process.env.SMARTOLT_URL,
    token: process.env.SMARTOLT_TOKEN,
  },
}));

export type AppConfig = ReturnType<typeof appConfig>;
