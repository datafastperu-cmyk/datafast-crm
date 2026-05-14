"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.winstonConfig = void 0;
const winston = require("winston");
const nest_winston_1 = require("nest-winston");
const path = require("path");
const logDir = process.env.LOG_DIR || '/app/logs';
const logLevel = process.env.LOG_LEVEL || 'info';
const isProduction = process.env.NODE_ENV === 'production';
const productionFormat = winston.format.combine(winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }), winston.format.errors({ stack: true }), winston.format.json());
const developmentFormat = winston.format.combine(winston.format.timestamp({ format: 'HH:mm:ss' }), winston.format.errors({ stack: true }), winston.format.colorize({ all: true }), winston.format.printf(({ timestamp, level, message, context, trace, ...meta }) => {
    const ctx = context ? `[${context}]` : '';
    const metaStr = Object.keys(meta).length ? `\n  ${JSON.stringify(meta, null, 2)}` : '';
    const traceStr = trace ? `\n  ${trace}` : '';
    return `${timestamp} ${level} ${ctx} ${message}${metaStr}${traceStr}`;
}));
exports.winstonConfig = nest_winston_1.WinstonModule.createLogger({
    level: logLevel,
    format: isProduction ? productionFormat : developmentFormat,
    defaultMeta: {
        service: 'fibranet-backend',
        env: process.env.NODE_ENV,
    },
    transports: [
        new winston.transports.Console({
            silent: process.env.NODE_ENV === 'test',
        }),
        ...(isProduction
            ? [
                new winston.transports.File({
                    filename: path.join(logDir, 'app.log'),
                    level: 'info',
                    maxsize: 10 * 1024 * 1024,
                    maxFiles: 10,
                    tailable: true,
                }),
                new winston.transports.File({
                    filename: path.join(logDir, 'error.log'),
                    level: 'error',
                    maxsize: 10 * 1024 * 1024,
                    maxFiles: 5,
                    tailable: true,
                }),
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
    exceptionHandlers: isProduction
        ? [new winston.transports.File({ filename: path.join(logDir, 'exceptions.log') })]
        : [],
    rejectionHandlers: isProduction
        ? [new winston.transports.File({ filename: path.join(logDir, 'rejections.log') })]
        : [],
    exitOnError: false,
});
//# sourceMappingURL=logger.config.js.map