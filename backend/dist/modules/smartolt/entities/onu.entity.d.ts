import { BaseModel } from '../../../common/entities/base.entity';
export declare enum EstadoOlt {
    ONLINE = "online",
    OFFLINE = "offline",
    MANTENIMIENTO = "mantenimiento",
    DESCONOCIDO = "desconocido"
}
export declare enum EstadoOnu {
    SIN_APROVISIONAR = "sin_aprovisionar",
    APROVISIONADA = "aprovisionada",
    ONLINE = "online",
    OFFLINE = "offline",
    ERROR = "error",
    REEMPLAZADA = "reemplazada"
}
export declare class Olt extends BaseModel {
    empresaId: string;
    nombre: string;
    descripcion: string;
    marca: string;
    modelo: string;
    smartoltId: string;
    ipGestion: string;
    usuario: string;
    passwordCifrado: string;
    estado: EstadoOlt;
    ultimoPing: Date;
    totalPonPorts: number;
    onusActivas: number;
    ubicacion: string;
    latitud: number;
    longitud: number;
    activo: boolean;
}
export declare class Onu extends BaseModel {
    empresaId: string;
    oltId: string;
    serialNumber: string;
    macAddress: string;
    modelo: string;
    marca: string;
    ponPort: string;
    ponSlot: number;
    ponSubslot: number;
    ponPortNum: number;
    onuId: number;
    perfilSmartolt: string;
    smartoltOnuId: string;
    vlanId: number;
    vlanModo: string;
    estado: EstadoOnu;
    rxPowerDbm: number;
    txPowerDbm: number;
    temperaturaC: number;
    voltajeV: number;
    distanciaKm: number;
    aprovisionadaEn: Date;
    aprovisionadaPor: string;
    ultimoOnline: Date;
    descripcion: string;
}
