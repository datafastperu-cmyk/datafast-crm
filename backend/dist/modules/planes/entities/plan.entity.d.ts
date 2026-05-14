import { BaseModel } from '../../../common/entities/base.entity';
export declare enum TipoPlan {
    RESIDENCIAL = "residencial",
    EMPRESARIAL = "empresarial",
    DEDICADO = "dedicado",
    PREPAGO = "prepago"
}
export declare enum TipoQueue {
    SIMPLE_QUEUE = "simple_queue",
    QUEUE_TREE = "queue_tree",
    PCQ = "pcq",
    SIN_LIMITE = "sin_limite"
}
export declare enum AccionAlLimite {
    REDUCIR_VELOCIDAD = "reducir_velocidad",
    BLOQUEAR = "bloquear",
    NOTIFICAR = "notificar",
    SIN_ACCION = "sin_accion"
}
export declare class Plan extends BaseModel {
    empresaId: string;
    nombre: string;
    descripcion: string;
    tipo: TipoPlan;
    colorUi: string;
    velocidadBajada: number;
    velocidadSubida: number;
    burstBajada: number;
    burstSubida: number;
    burstTiempo: number;
    velocidadGarantizada: number;
    precio: number;
    precioInstalacion: number;
    aplicaIgv: boolean;
    tipoQueue: TipoQueue;
    pppProfile: string;
    pppService: string;
    poolIp: string;
    vlanId: number;
    tipoServicio: string;
    cicloFacturacion: string;
    diasContratoMinimo: number;
    tieneLimiteDatos: boolean;
    limiteDatosGb: number;
    accionAlLimite: AccionAlLimite;
    velocidadPostLimite: number;
    activo: boolean;
    visibleEnPortal: boolean;
    ordenDisplay: number;
    get maxLimitMikrotik(): string;
    get descripcionVelocidad(): string;
}
