export declare enum MetodoPago {
    EFECTIVO = "efectivo",
    YAPE = "yape",
    PLIN = "plin",
    TRANSFERENCIA_BANCARIA = "transferencia_bancaria",
    DEPOSITO_BANCARIO = "deposito_bancario",
    MERCADOPAGO = "mercadopago",
    TARJETA_CREDITO = "tarjeta_credito",
    TARJETA_DEBITO = "tarjeta_debito",
    CHEQUE = "cheque",
    OTRO = "otro"
}
export declare enum EstadoPago {
    PENDIENTE_VERIFICACION = "pendiente_verificacion",
    VERIFICADO = "verificado",
    RECHAZADO = "rechazado",
    DEVUELTO = "devuelto"
}
export declare class Pago {
    id: string;
    empresaId: string;
    clienteId: string;
    facturaId: string;
    contratoId: string;
    monto: number;
    moneda: string;
    metodoPago: MetodoPago;
    banco: string;
    numeroOperacion: string;
    numeroCuenta: string;
    estado: EstadoPago;
    verificadoPor: string;
    verificadoEn: Date;
    motivoRechazo: string;
    comprobanteUrl: string;
    mpPaymentId: string;
    mpStatus: string;
    mpPreferenceId: string;
    mpDetail: Record<string, any>;
    fechaPago: string;
    registradoEn: Date;
    cajeroId: string;
    notas: string;
    conciliado: boolean;
    conciliadoEn: Date;
    conciliadoPor: string;
    extractoBancoRef: string;
    createdAt: Date;
    updatedAt: Date;
    get estaVerificado(): boolean;
    get etiquetaMetodo(): string;
}
export declare class CuentaBancaria {
    id: string;
    empresaId: string;
    banco: string;
    tipoCuenta: string;
    numeroCuenta: string;
    cci: string;
    moneda: string;
    titular: string;
    activa: boolean;
    esPrincipal: boolean;
    logoBanco: string;
    createdAt: Date;
}
