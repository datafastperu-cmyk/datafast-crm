import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
export interface MpPreferencia {
    id: string;
    init_point: string;
    sandbox_init_point: string;
}
export interface MpPaymentDetail {
    id: number;
    status: string;
    status_detail: string;
    transaction_amount: number;
    currency_id: string;
    date_approved: string;
    payer: {
        email: string;
        first_name: string;
        last_name: string;
    };
    payment_method_id: string;
    payment_type_id: string;
    external_reference?: string;
    metadata?: Record<string, any>;
}
export declare class MercadoPagoService {
    private readonly config;
    private readonly http;
    private readonly logger;
    private readonly baseUrl;
    private readonly accessToken;
    private readonly webhookSecret;
    constructor(config: ConfigService, http: HttpService);
    crearPreferencia(params: {
        facturaId: string;
        titulo: string;
        descripcion: string;
        monto: number;
        clienteEmail: string;
        urlExito?: string;
        urlFallo?: string;
        urlPendiente?: string;
    }): Promise<MpPreferencia>;
    consultarPago(paymentId: string): Promise<MpPaymentDetail>;
    validarWebhookSignature(rawBody: string | Buffer, xSignature: string, xRequestId: string): boolean;
    esAprobado(payment: MpPaymentDetail): boolean;
    esPendiente(payment: MpPaymentDetail): boolean;
    private getHeaders;
}
