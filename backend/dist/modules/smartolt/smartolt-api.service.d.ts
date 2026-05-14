import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
export interface SmartoltOnu {
    id: string;
    serial: string;
    pon_port: string;
    pon_type: string;
    status: string;
    profile: string;
    vlan: number;
    description?: string;
    model?: string;
    rx_power?: number;
    tx_power?: number;
    temperature?: number;
    distance_km?: number;
    uptime?: string;
    last_seen?: string;
    olt_id: string;
    created_at?: string;
}
export interface SmartoltOnuNoAprovisionada {
    serial: string;
    pon_port: string;
    pon_type: string;
    olt_id: string;
    detected_at?: string;
    model?: string;
}
export interface SmartoltProfile {
    id: string;
    name: string;
    vlan?: number;
    bandwidth?: string;
    type: string;
}
export interface SmartoltOlt {
    id: string;
    name: string;
    ip: string;
    model: string;
    status: string;
    onu_count: number;
    pon_ports: number;
}
export interface ProvisionarOnuPayload {
    serial: string;
    olt_id: string;
    pon_port: string;
    profile: string;
    vlan: number;
    description?: string;
    vlan_mode?: string;
}
export declare class SmartoltApiService {
    private readonly http;
    private readonly config;
    private readonly logger;
    private readonly baseUrl;
    private readonly token;
    private readonly TIMEOUT_MS;
    constructor(http: HttpService, config: ConfigService);
    listarOlts(): Promise<SmartoltOlt[]>;
    getOlt(oltId: string): Promise<SmartoltOlt>;
    listarOnusDeOlt(oltId: string): Promise<SmartoltOnu[]>;
    getOnu(oltId: string, onuId: string): Promise<SmartoltOnu>;
    getOnuBySerial(serial: string): Promise<SmartoltOnu | null>;
    getSeñalOnu(oltId: string, onuId: string): Promise<{
        rxPower: number;
        txPower: number;
        temperature: number;
        voltaje: number;
    }>;
    listarOnusNoAprovisionadas(oltId?: string): Promise<SmartoltOnuNoAprovisionada[]>;
    detectarOnuEnPuerto(oltId: string, ponPort: string): Promise<SmartoltOnuNoAprovisionada | null>;
    listarPerfiles(): Promise<SmartoltProfile[]>;
    getPerfilPorNombre(nombre: string): Promise<SmartoltProfile | null>;
    aprovisionarOnu(payload: ProvisionarOnuPayload): Promise<SmartoltOnu>;
    eliminarProvision(oltId: string, onuId: string): Promise<void>;
    eliminarProvisionPorSerial(serial: string): Promise<void>;
    reiniciarOnu(oltId: string, onuId: string): Promise<void>;
    actualizarOnu(oltId: string, onuId: string, params: {
        profile?: string;
        vlan?: number;
        description?: string;
    }): Promise<SmartoltOnu>;
    getEstadisticasOlt(oltId: string): Promise<{
        onusOnline: number;
        onusOffline: number;
        onusTotal: number;
        rxPromedio: number;
        txPromedio: number;
    }>;
    verificarConectividad(): Promise<{
        conectado: boolean;
        version?: string;
        mensaje: string;
    }>;
    private getHeaders;
    private getConfig;
    private checkConfig;
    private get;
    private post;
    private put;
    private delete;
    private handleHttpError;
}
