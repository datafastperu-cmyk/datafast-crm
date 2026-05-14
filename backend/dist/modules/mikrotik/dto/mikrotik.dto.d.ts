import { MetodoConexion } from '../entities/router.entity';
export declare class CreateRouterDto {
    nombre: string;
    descripcion?: string;
    ubicacion?: string;
    modelo?: string;
    ipGestion: string;
    puertoApi?: number;
    puertoApiSsl?: number;
    puertoSsh?: number;
    usuario: string;
    password: string;
    metodoConexion?: MetodoConexion;
    usarSsl?: boolean;
    timeoutConexion?: number;
    latitud?: number;
    longitud?: number;
    snmpCommunity?: string;
    autoConfigurarQueues?: boolean;
    autoConfigurarPppoe?: boolean;
    autoConfigurarFirewall?: boolean;
}
declare const UpdateRouterDto_base: import("@nestjs/common").Type<Partial<CreateRouterDto>>;
export declare class UpdateRouterDto extends UpdateRouterDto_base {
}
export declare class ProvisionarClienteDto {
    clienteId: string;
    usuarioPppoe: string;
    passwordPppoe: string;
    ipAsignada: string;
    perfilPppoe?: string;
    downloadMbps: number;
    uploadMbps: number;
    burstDownMbps?: number;
    burstUpMbps?: number;
    burstTiempoSegundos?: number;
    tipoQueue?: string;
}
export declare class SuspenderClienteDto {
    clienteId: string;
    ipAsignada: string;
    usuarioPppoe?: string;
    motivo?: string;
}
export declare class ReactivarClienteDto {
    clienteId: string;
    ipAsignada: string;
}
export declare class DhcpBindingDto {
    macAddress: string;
    ipAddress: string;
    hostname?: string;
    comment?: string;
}
export declare class ActualizarQueueDto {
    nombreQueue: string;
    downloadMbps: number;
    uploadMbps: number;
}
export declare class PingDto {
    destino: string;
    count?: number;
}
export {};
