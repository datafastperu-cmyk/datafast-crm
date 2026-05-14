import { TipoPlan, TipoQueue, AccionAlLimite } from '../entities/plan.entity';
import { PaginationDto } from '../../../common/dto/response.dto';
export declare class CreatePlanDto {
    nombre: string;
    descripcion?: string;
    tipo?: TipoPlan;
    colorUi?: string;
    velocidadBajada: number;
    velocidadSubida: number;
    burstBajada?: number;
    burstSubida?: number;
    burstTiempo?: number;
    velocidadGarantizada?: number;
    precio: number;
    precioInstalacion?: number;
    aplicaIgv?: boolean;
    tipoQueue: TipoQueue;
    pppProfile?: string;
    pppService?: string;
    poolIp?: string;
    vlanId?: number;
    tipoServicio?: string;
    cicloFacturacion?: string;
    tieneLimiteDatos?: boolean;
    limiteDatosGb?: number;
    accionAlLimite?: AccionAlLimite;
    velocidadPostLimite?: number;
    activo?: boolean;
    visibleEnPortal?: boolean;
    ordenDisplay?: number;
}
declare const UpdatePlanDto_base: import("@nestjs/common").Type<Partial<CreatePlanDto>>;
export declare class UpdatePlanDto extends UpdatePlanDto_base {
}
export declare class FilterPlanDto extends PaginationDto {
    tipo?: TipoPlan;
    tipoServicio?: string;
    activo?: boolean;
    visibleEnPortal?: boolean;
}
export {};
