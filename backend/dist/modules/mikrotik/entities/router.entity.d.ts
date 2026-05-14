import { BaseModel } from '../../../common/entities/base.entity';
export declare enum VersionRouterOS {
    V6 = "v6",
    V7 = "v7",
    DESCONOCIDA = "desconocida"
}
export declare enum MetodoConexion {
    API = "api",
    API_SSL = "api_ssl",
    SSH = "ssh",
    SNMP = "snmp"
}
export declare enum EstadoEquipo {
    ONLINE = "online",
    OFFLINE = "offline",
    DEGRADADO = "degradado",
    MANTENIMIENTO = "mantenimiento",
    DESCONOCIDO = "desconocido"
}
export declare class Router extends BaseModel {
    empresaId: string;
    nombre: string;
    descripcion: string;
    ubicacion: string;
    modelo: string;
    ipGestion: string;
    puertoApi: number;
    puertoApiSsl: number;
    puertoSsh: number;
    usuario: string;
    passwordCifrado: string;
    versionRos: VersionRouterOS;
    metodoConexion: MetodoConexion;
    usarSsl: boolean;
    timeoutConexion: number;
    estado: EstadoEquipo;
    ultimoPing: Date;
    latenciaMs: number;
    uptimeSegundos: number;
    versionFirmware: string;
    identityRouteros: string;
    cpuUsoPct: number;
    memoriaUsoPct: number;
    temperaturaC: number;
    latitud: number;
    longitud: number;
    autoConfigurarQueues: boolean;
    autoConfigurarPppoe: boolean;
    autoConfigurarFirewall: boolean;
    snmpCommunity: string;
    snmpVersion: number;
    activo: boolean;
}
