"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JOB_OPTIONS = exports.JOBS = exports.QUEUES = void 0;
exports.QUEUES = {
    COBRANZA: 'cobranza',
    FACTURACION: 'facturacion',
    NOTIFICACIONES: 'notificaciones',
    MIKROTIK: 'mikrotik-jobs',
};
exports.JOBS = {
    DETECTAR_MOROSOS: 'detectar-morosos',
    SUSPENDER_CONTRATO: 'suspender-contrato',
    REACTIVAR_CONTRATO: 'reactivar-contrato',
    EVALUAR_PRORROGA: 'evaluar-prorroga',
    VENCER_PRORROGA: 'vencer-prorroga',
    PROCESAR_PAGO: 'procesar-pago',
    GENERAR_FACTURAS_EMPRESA: 'generar-facturas-empresa',
    GENERAR_FACTURA_CONTRATO: 'generar-factura-contrato',
    MARCAR_FACTURAS_VENCIDAS: 'marcar-facturas-vencidas',
    NOTIF_COBRO_PREVIO: 'notif-cobro-previo',
    NOTIF_VENCIMIENTO: 'notif-vencimiento',
    NOTIF_CORTE: 'notif-corte',
    NOTIF_REACTIVACION: 'notif-reactivacion',
    NOTIF_FACTURA: 'notif-factura',
    MK_SUSPENDER: 'mk-suspender',
    MK_REACTIVAR: 'mk-reactivar',
    MK_SYNC_VELOCIDADES: 'mk-sync-velocidades',
};
exports.JOB_OPTIONS = {
    CRITICO: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: 500,
        removeOnFail: 1000,
    },
    NOTIFICACION: {
        attempts: 2,
        backoff: { type: 'fixed', delay: 60_000 },
        removeOnComplete: 200,
        removeOnFail: 200,
    },
    MASIVO: {
        attempts: 1,
        removeOnComplete: 100,
        removeOnFail: 500,
    },
    MIKROTIK: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: 200,
        removeOnFail: 500,
    },
};
//# sourceMappingURL=workers.constants.js.map