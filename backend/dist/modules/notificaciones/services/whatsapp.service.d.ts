import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
export declare enum TipoNotificacion {
    SERVICIO_ACTIVADO = "servicio_activado",
    SERVICIO_SUSPENDIDO = "servicio_suspendido",
    SERVICIO_REACTIVADO = "servicio_reactivado",
    FACTURA_EMITIDA = "factura_emitida",
    PAGO_RECIBIDO = "pago_recibido",
    PAGO_VENCE_HOY = "pago_vence_hoy",
    PAGO_VENCIDO = "pago_vencido",
    PRORROGA_CONCEDIDA = "prorroga_concedida",
    BIENVENIDA = "bienvenida",
    ONU_OFFLINE = "onu_offline",
    MANTENIMIENTO = "mantenimiento"
}
export interface WhatsAppParams {
    telefono: string;
    tipo: TipoNotificacion;
    variables: Record<string, string>;
    empresaId?: string;
    clienteId?: string;
}
export declare class WhatsAppService {
    private readonly http;
    private readonly config;
    private readonly logger;
    private readonly apiUrl;
    private readonly token;
    private readonly phoneId;
    private readonly enabled;
    constructor(http: HttpService, config: ConfigService);
    enviar(params: WhatsAppParams): Promise<{
        enviado: boolean;
        messageId?: string;
        error?: string;
    }>;
    notificarServicioActivado(params: {
        telefono: string;
        clienteNombre: string;
        planNombre: string;
        ipAsignada: string;
        usuarioPppoe: string;
        empresaId?: string;
        clienteId?: string;
    }): Promise<{
        enviado: boolean;
        messageId?: string;
        error?: string;
    }>;
    notificarServicioSuspendido(params: {
        telefono: string;
        clienteNombre: string;
        deudaTotal: number;
        numeroCuenta?: string;
        nombreEmpresa?: string;
        empresaId?: string;
        clienteId?: string;
    }): Promise<{
        enviado: boolean;
        messageId?: string;
        error?: string;
    }>;
    notificarServicioReactivado(params: {
        telefono: string;
        clienteNombre: string;
        planNombre: string;
        empresaId?: string;
        clienteId?: string;
    }): Promise<{
        enviado: boolean;
        messageId?: string;
        error?: string;
    }>;
    notificarFacturaEmitida(params: {
        telefono: string;
        clienteNombre: string;
        numeroFactura: string;
        montoTotal: number;
        fechaVencimiento: string;
        empresaId?: string;
        clienteId?: string;
    }): Promise<{
        enviado: boolean;
        messageId?: string;
        error?: string;
    }>;
    notificarPagoRecibido(params: {
        telefono: string;
        clienteNombre: string;
        montoPago: number;
        metodoPago: string;
        saldoPendiente: number;
        empresaId?: string;
        clienteId?: string;
    }): Promise<{
        enviado: boolean;
        messageId?: string;
        error?: string;
    }>;
    notificarBienvenida(params: {
        telefono: string;
        clienteNombre: string;
        planNombre: string;
        velocidadBajada: number;
        velocidadSubida: number;
        usuarioPppoe: string;
        empresaId?: string;
        clienteId?: string;
    }): Promise<{
        enviado: boolean;
        messageId?: string;
        error?: string;
    }>;
    enviarMasivo(mensajes: WhatsAppParams[], delayMs?: number): Promise<{
        exitosos: number;
        fallidos: number;
    }>;
    private buildComponents;
    private normalizarTelefono;
}
