import { EstadoOnu } from '../entities/onu.entity';
import { PaginationDto } from '../../../common/dto/response.dto';
export declare class CreateOltDto {
    nombre: string;
    descripcion?: string;
    marca?: string;
    modelo?: string;
    smartoltId?: string;
    ipGestion?: string;
    usuario?: string;
    password?: string;
    ubicacion?: string;
    totalPonPorts?: number;
    activo?: boolean;
}
declare const UpdateOltDto_base: import("@nestjs/common").Type<Partial<CreateOltDto>>;
export declare class UpdateOltDto extends UpdateOltDto_base {
}
export declare class ProvisionarOnuDto {
    oltId: string;
    serialNumber: string;
    ponPort: string;
    perfil: string;
    vlanId: number;
    vlanModo?: string;
    descripcion?: string;
    contratoId?: string;
    modelo?: string;
}
export declare class FlujoComipletoFtthDto {
    contratoId: string;
    clienteId: string;
    oltId: string;
    serialNumber?: string;
    ponPort: string;
    perfil: string;
    vlanId: number;
    routerId: string;
    segmentoId?: string;
    notificarCliente?: boolean;
}
export declare class AsociarOnuContratoDto {
    contratoId: string;
    onuId: string;
}
export declare class FilterOnuDto extends PaginationDto {
    estado?: EstadoOnu;
    oltId?: string;
    serialNumber?: string;
    ponPort?: string;
    sinContrato?: boolean;
}
export declare class ActualizarSeñalDto {
    rxPowerDbm?: number;
    txPowerDbm?: number;
    temperaturaC?: number;
}
export declare class FlujoComipletoResultadoDto {
    pasos: Array<{
        paso: number;
        nombre: string;
        estado: 'ok' | 'error' | 'omitido';
        detalle: string;
        duracionMs?: number;
    }>;
    exitoso: boolean;
    onuId?: string;
    ipAsignada?: string;
    usuarioPppoe?: string;
    mensajeFinal: string;
}
export {};
