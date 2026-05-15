import * as winston from 'winston';
import { WinstonModule } from 'nest-winston';
import * as path from 'path';

const logDir = process.env.LOG_DIR || '/app/logs';
const logLevel = process.env.LOG_LEVEL || 'info';
const isProduction = process.env.NODE_ENV === 'production';

// ─── Formato para producción (JSON estructurado) ──────────────
const productionFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

// ─── Formato para desarrollo (legible) ────────────────────────
const developmentFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, context, trace, ...meta }) => {
    const ctx = context ? `[${context}]` : '';
    const metaStr = Object.keys(meta).length ? `\n  ${JSON.stringify(meta, null, 2)}` : '';
    const traceStr = trace ? `\n  ${trace}` : '';
    return `${timestamp} ${level} ${ctx} ${message}${metaStr}${traceStr}`;
  }),
);

export const winstonConfig = WinstonModule.createLogger({
  level: logLevel,
  format: isProduction ? productionFormat : developmentFormat,
  defaultMeta: {
    service: 'datafast-backend',
    env: process.env.NODE_ENV,
  },
  transports: [
    // ── Consola siempre ──────────────────────────────────────
    new winston.transports.Console({
      silent: process.env.NODE_ENV === 'test',
    }),

    // ── Archivos en producción ───────────────────────────────
    ...(isProduction
      ? [
          // Log general (info+)
          new winston.transports.File({
            filename: path.join(logDir, 'app.log'),
            level: 'info',
            maxsize: 10 * 1024 * 1024, // 10MB
            maxFiles: 10,
            tailable: true,
          }),
          // Errores separados
          new winston.transports.File({
            filename: path.join(logDir, 'error.log'),
            level: 'error',
            maxsize: 10 * 1024 * 1024,
            maxFiles: 5,
            tailable: true,
          }),
          // Auditoría (acciones de usuarios)
          new winston.transports.File({
            filename: path.join(logDir, 'audit.log'),
            level: 'info',
            maxsize: 20 * 1024 * 1024,
            maxFiles: 30,
            tailable: true,
          }),
        ]
      : []),
  ],
  // No crashear en errores de logging
  exceptionHandlers: isProduction
    ? [new winston.transports.File({ filename: path.join(logDir, 'exceptions.log') })]
    : [],
  rejectionHandlers: isProduction
    ? [new winston.transports.File({ filename: path.join(logDir, 'rejections.log') })]
    : [],
  exitOnError: false,
});
