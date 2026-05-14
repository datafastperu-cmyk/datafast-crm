import * as Joi from 'joi';
export declare const validationSchema: Joi.ObjectSchema<any>;
export declare const appConfig: (() => {
    env: string;
    port: number;
    url: string;
    frontendUrl: string;
    allowedOrigins: string[];
    timezone: string;
    uploadDir: string;
    maxFileSizeMb: number;
    logLevel: string;
    logDir: string;
    encryptionKey: string;
    billing: {
        day: number;
        graceDays: number;
        igvRate: number;
        currency: string;
        currencySymbol: string;
    };
    monitoring: {
        pingInterval: number;
        snmpInterval: number;
        latencyThreshold: number;
        packetLossThreshold: number;
    };
    reniec: {
        url: string;
        token: string;
    };
    googleMapsKey: string;
    smartolt: {
        url: string;
        token: string;
    };
}) & import("@nestjs/config").ConfigFactoryKeyHost<{
    env: string;
    port: number;
    url: string;
    frontendUrl: string;
    allowedOrigins: string[];
    timezone: string;
    uploadDir: string;
    maxFileSizeMb: number;
    logLevel: string;
    logDir: string;
    encryptionKey: string;
    billing: {
        day: number;
        graceDays: number;
        igvRate: number;
        currency: string;
        currencySymbol: string;
    };
    monitoring: {
        pingInterval: number;
        snmpInterval: number;
        latencyThreshold: number;
        packetLossThreshold: number;
    };
    reniec: {
        url: string;
        token: string;
    };
    googleMapsKey: string;
    smartolt: {
        url: string;
        token: string;
    };
}>;
export type AppConfig = ReturnType<typeof appConfig>;
