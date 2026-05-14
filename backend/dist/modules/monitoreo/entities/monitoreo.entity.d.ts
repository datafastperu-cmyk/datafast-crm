import { BaseModel } from '../../../common/entities/base.entity';
export declare enum TipoNodo {
    ROUTER = "router",
    SWITCH = "switch",
    OLT = "olt",
    ANTENA = "antena",
    SERVIDOR = "servidor",
    CLIENTE = "cliente",
    ENLACE_UPLINK = "enlace_uplink"
}
export declare enum EstadoNodo {
    ONLINE = "online",
    OFFLINE = "offline",
    DEGRADADO = "degradado",
    MANTENIMIENTO = "mantenimiento",
    DESCONOCIDO = "desconocido"
}
export declare enum NivelAlerta {
    INFO = "info",
    WARNING = "warning",
    CRITICAL = "critical",
    RECOVERY = "recovery"
}
export declare enum EstadoAlerta {
    ACTIVA = "activa",
    RESUELTA = "resuelta",
    IGNORADA = "ignorada"
}
export declare enum MetricaAlerta {
    PING_LATENCIA = "ping_latencia",
    PING_PERDIDA = "ping_perdida",
    CPU = "cpu",
    MEMORIA = "memoria",
    TRAFICO_BAJADA = "trafico_bajada",
    TRAFICO_SUBIDA = "trafico_subida",
    TEMPERATURA = "temperatura",
    ESTADO_NODO = "estado_nodo",
    SESIONES_PPPOE = "sesiones_pppoe",
    SENAL_ONU = "senal_onu"
}
export declare class Nodo extends BaseModel {
    empresaId: string;
    nombre: string;
    descripcion: string;
    tipo: TipoNodo;
    routerId: string;
    oltId: string;
    ipMonitoreo: string;
    snmpHabilitado: boolean;
    snmpCommunity: string;
    snmpVersion: number;
    snmpPuerto: number;
    snmpOidTraficoRx: string;
    snmpOidTraficoTx: string;
    snmpOidCpu: string;
    snmpInterfaceIndex: number;
    pingHabilitado: boolean;
    pingIntervaloSeg: number;
    pingTimeoutMs: number;
    pingReintentos: number;
    estado: EstadoNodo;
    ultimoPing: Date;
    latenciaMs: number;
    perdidaPct: number;
    estadoDesde: Date;
    uptimePct7d: number;
    cpuUsoPct: number;
    memoriaUsoPct: number;
    traficoRxBps: number;
    traficoTxBps: number;
    temperaturaC: number;
    sesionesPppoe: number;
    activo: boolean;
    alertasHabilitadas: boolean;
    latitud: number;
    longitud: number;
}
export declare class MedicionNodo {
    id: string;
    nodoId: string;
    empresaId: string;
    timestamp: Date;
    latenciaMs: number;
    perdidaPct: number;
    online: boolean;
    cpuPct: number;
    memoriaPct: number;
    traficoRxBps: number;
    traficoTxBps: number;
    temperaturaC: number;
    sesionesPppoe: number;
}
export declare class Alerta extends BaseModel {
    empresaId: string;
    nodoId: string;
    nodoNombre: string;
    nivel: NivelAlerta;
    estado: EstadoAlerta;
    metrica: MetricaAlerta;
    mensaje: string;
    detalle: string;
    valorActual: number;
    umbral: number;
    resueltaEn: Date;
    resueltaPor: string;
    duracionMinutos: number;
    notificadoEmail: boolean;
    notificadoWhatsapp: boolean;
}
export declare class ConfiguracionAlerta extends BaseModel {
    empresaId: string;
    nodoId: string;
    metrica: MetricaAlerta;
    umbralWarning: number;
    umbralCritical: number;
    duracionMinutos: number;
    notificarEmail: boolean;
    notificarWhatsapp: boolean;
    emailDestino: string;
    telefonoDestino: string;
    activo: boolean;
    descripcion: string;
}
