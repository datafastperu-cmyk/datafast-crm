import { MetodoPago, EstadoPago } from '../entities/pago.entity';
import { PaginationDto } from '../../../common/dto/response.dto';
export declare class RegistrarPagoDto {
    clienteId: string;
    facturaId?: string;
    contratoId?: string;
    monto: number;
    metodoPago: MetodoPago;
    banco?: string;
    numeroOperacion?: string;
    numeroCuenta?: string;
    fechaPago?: string;
    notas?: string;
    comprobanteUrl?: string;
    autoVerificar?: boolean;
    moneda?: string;
}
export declare class VerificarPagoDto {
    aprobado: boolean;
    motivoRechazo?: string;
    extractoBancoRef?: string;
}
export declare class ConciliarPagoDto {
    extractoBancoRef: string;
    notas?: string;
}
export declare class FilterPagoDto extends PaginationDto {
    estado?: EstadoPago;
    metodoPago?: MetodoPago;
    clienteId?: string;
    facturaId?: string;
    contratoId?: string;
    cajeroId?: string;
    banco?: string;
    numeroOperacion?: string;
    fechaDesde?: string;
    fechaHasta?: string;
    conciliado?: boolean;
    soloHoy?: boolean;
}
export declare class MercadoPagoWebhookDto {
    action: string;
    api_version: string;
    data: {
        id: string;
    };
    date_created: string;
    id: string;
    live_mode: boolean;
    type: string;
    user_id: string;
}
export declare class CrearPreferenciaDto {
    facturaId: string;
    urlExito?: string;
    urlFallo?: string;
    urlPendiente?: string;
}
export declare class CreateCuentaBancariaDto {
    banco: string;
    tipoCuenta?: string;
    numeroCuenta: string;
    cci?: string;
    moneda?: string;
    titular?: string;
    esPrincipal?: boolean;
}
export declare class ResumenCobranzaDto {
    cobradoHoy: number;
    cobradoSemana: number;
    cobradoMes: number;
    cobradoMesAnterior: number;
    pagosHoy: number;
    pagosSemana: number;
    pagosMes: number;
    pendientesVerificar: number;
    porMetodo: Record<string, {
        total: number;
        monto: number;
    }>;
    ultimosPagos: Partial<Pago>[];
}
import { Pago } from '../entities/pago.entity';
