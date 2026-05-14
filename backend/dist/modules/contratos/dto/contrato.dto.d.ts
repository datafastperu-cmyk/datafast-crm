import { EstadoContrato } from '../entities/contrato.entity';
import { PaginationDto } from '../../../common/dto/response.dto';
export declare class CreateContratoDto {
    clienteId: string;
    planId: string;
    routerId?: string;
    nodoId?: string;
    segmentoId?: string;
    ipManual?: string;
    tecnicoInstalacionId?: string;
    vendedorId?: string;
    fechaInicio: string;
    fechaVencimiento?: string;
    direccionInstalacion?: string;
    latitudInstalacion?: number;
    longitudInstalacion?: number;
    usuarioPppoe?: string;
    passwordPppoePlain?: string;
    vlanId?: number;
    precioMensual?: number;
    descuentoPct?: number;
    descuentoMotivo?: string;
    diaFacturacion?: number;
    notasInstalacion?: string;
    notasTecnicas?: string;
    notasAdmin?: string;
}
declare const UpdateContratoDto_base: import("@nestjs/common").Type<Partial<CreateContratoDto>>;
export declare class UpdateContratoDto extends UpdateContratoDto_base {
}
export declare class CambiarEstadoContratoDto {
    estado: EstadoContrato;
    motivo?: string;
}
export declare class OtorgarProrrogaDto {
    prorrogaHasta: string;
    motivo: string;
}
export declare class FilterContratoDto extends PaginationDto {
    estado?: EstadoContrato;
    estados?: EstadoContrato[];
    clienteId?: string;
    planId?: string;
    routerId?: string;
    tecnicoInstalacionId?: string;
    conMora?: boolean;
    enProrroga?: boolean;
    aprovisionado?: boolean;
    fechaDesde?: string;
    fechaHasta?: string;
}
export declare class ContratoCompletoDto {
    id: string;
    numeroContrato: string;
    estado: EstadoContrato;
    fechaInicio: string;
    fechaVencimiento: string;
    ipAsignada: string;
    usuarioPppoe: string;
    precioFinal: number;
    deudaTotal: number;
    mesesDeuda: number;
    enProrroga: boolean;
    prorrogaHasta: string;
    aprovisionado: boolean;
    cliente: {
        id: string;
        nombreCompleto: string;
        telefono: string;
        email: string;
    };
    plan: {
        id: string;
        nombre: string;
        velocidadBajada: number;
        velocidadSubida: number;
        tipoQueue: string;
    };
    router: {
        id: string;
        nombre: string;
        ipGestion: string;
    } | null;
}
export {};
