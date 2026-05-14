export declare const QUEUES: {
    readonly COBRANZA: "cobranza";
    readonly FACTURACION: "facturacion";
    readonly NOTIFICACIONES: "notificaciones";
    readonly MIKROTIK: "mikrotik-jobs";
};
export declare const JOBS: {
    readonly DETECTAR_MOROSOS: "detectar-morosos";
    readonly SUSPENDER_CONTRATO: "suspender-contrato";
    readonly REACTIVAR_CONTRATO: "reactivar-contrato";
    readonly EVALUAR_PRORROGA: "evaluar-prorroga";
    readonly VENCER_PRORROGA: "vencer-prorroga";
    readonly PROCESAR_PAGO: "procesar-pago";
    readonly GENERAR_FACTURAS_EMPRESA: "generar-facturas-empresa";
    readonly GENERAR_FACTURA_CONTRATO: "generar-factura-contrato";
    readonly MARCAR_FACTURAS_VENCIDAS: "marcar-facturas-vencidas";
    readonly NOTIF_COBRO_PREVIO: "notif-cobro-previo";
    readonly NOTIF_VENCIMIENTO: "notif-vencimiento";
    readonly NOTIF_CORTE: "notif-corte";
    readonly NOTIF_REACTIVACION: "notif-reactivacion";
    readonly NOTIF_FACTURA: "notif-factura";
    readonly MK_SUSPENDER: "mk-suspender";
    readonly MK_REACTIVAR: "mk-reactivar";
    readonly MK_SYNC_VELOCIDADES: "mk-sync-velocidades";
};
export interface PayloadSuspenderContrato {
    contratoId: string;
    empresaId: string;
    clienteId: string;
    routerId: string;
    ipAsignada: string;
    usuarioPppoe: string;
    deudaTotal: number;
    mesesDeuda: number;
    notificar?: boolean;
}
export interface PayloadReactivarContrato {
    contratoId: string;
    empresaId: string;
    clienteId: string;
    routerId: string;
    ipAsignada: string;
    planNombre: string;
    notificar?: boolean;
}
export interface PayloadEvaluarProrroga {
    contratoId: string;
    empresaId: string;
    clienteId: string;
    prorrogaHasta: string;
}
export interface PayloadProcesarPago {
    pagoId: string;
    facturaId: string;
    contratoId: string;
    empresaId: string;
    montoPago: number;
    fechaPago: string;
}
export interface PayloadGenerarFacturasEmpresa {
    empresaId: string;
    mes: number;
    anio: number;
    diaFacturacion?: number;
    forzar?: boolean;
}
export interface PayloadGenerarFacturaContrato {
    contratoId: string;
    empresaId: string;
    mes: number;
    anio: number;
}
export interface PayloadNotificacionCobro {
    clienteId: string;
    empresaId: string;
    telefono: string;
    nombre: string;
    montoDeuda: number;
    diasAntes: number;
    facturaIds: string[];
}
export interface PayloadMkSuspender {
    contratoId: string;
    routerId: string;
    empresaId: string;
    ipAsignada: string;
    usuarioPppoe: string;
}
export interface PayloadMkReactivar {
    contratoId: string;
    routerId: string;
    empresaId: string;
    ipAsignada: string;
}
export declare const JOB_OPTIONS: {
    readonly CRITICO: {
        readonly attempts: 3;
        readonly backoff: {
            readonly type: "exponential";
            readonly delay: 30000;
        };
        readonly removeOnComplete: 500;
        readonly removeOnFail: 1000;
    };
    readonly NOTIFICACION: {
        readonly attempts: 2;
        readonly backoff: {
            readonly type: "fixed";
            readonly delay: 60000;
        };
        readonly removeOnComplete: 200;
        readonly removeOnFail: 200;
    };
    readonly MASIVO: {
        readonly attempts: 1;
        readonly removeOnComplete: 100;
        readonly removeOnFail: 500;
    };
    readonly MIKROTIK: {
        readonly attempts: 3;
        readonly backoff: {
            readonly type: "exponential";
            readonly delay: 10000;
        };
        readonly removeOnComplete: 200;
        readonly removeOnFail: 500;
    };
};
