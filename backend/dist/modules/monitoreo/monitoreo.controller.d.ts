import { Queue } from 'bull';
import { Repository } from 'typeorm';
import { AlertasService } from './services/alertas.service';
import { PingService } from './services/ping.service';
import { SnmpService } from './services/snmp.service';
import { MonitoreoGateway } from './gateways/monitoreo.gateway';
import { Nodo, MedicionNodo, ConfiguracionAlerta, TipoNodo, MetricaAlerta } from './entities/monitoreo.entity';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { ApiResponse as StdResponse } from '../../common/dto/response.dto';
declare class CreateNodoDto {
    nombre: string;
    descripcion?: string;
    tipo?: TipoNodo;
    routerId?: string;
    oltId?: string;
    ipMonitoreo: string;
    snmpHabilitado?: boolean;
    snmpCommunity?: string;
    snmpVersion?: number;
    snmpInterfaceIndex?: number;
    pingHabilitado?: boolean;
    pingIntervaloSeg?: number;
    latitud?: number;
    longitud?: number;
}
declare class CreateConfigAlertaDto {
    nodoId?: string;
    metrica: MetricaAlerta;
    umbralWarning: number;
    umbralCritical: number;
    notificarWhatsapp?: boolean;
    telefonoDestino?: string;
}
export declare class MonitoreoController {
    private readonly nodoRepo;
    private readonly medicionRepo;
    private readonly configRepo;
    private readonly queue;
    private readonly alertasSvc;
    private readonly pingSvc;
    private readonly snmpSvc;
    private readonly gateway;
    private readonly logger;
    constructor(nodoRepo: Repository<Nodo>, medicionRepo: Repository<MedicionNodo>, configRepo: Repository<ConfiguracionAlerta>, queue: Queue, alertasSvc: AlertasService, pingSvc: PingService, snmpSvc: SnmpService, gateway: MonitoreoGateway);
    crearNodo(dto: CreateNodoDto, user: JwtPayload): Promise<StdResponse<Nodo>>;
    listarNodos(user: JwtPayload): Promise<StdResponse<Nodo[]>>;
    getNodo(id: string, user: JwtPayload): Promise<StdResponse<any>>;
    updateNodo(id: string, dto: Partial<CreateNodoDto>, user: JwtPayload): Promise<StdResponse<Nodo>>;
    deleteNodo(id: string, user: JwtPayload): Promise<void>;
    pingNodo(id: string, user: JwtPayload): Promise<StdResponse<any>>;
    pingIp(body: {
        ip: string;
        count?: number;
    }, user: JwtPayload): Promise<StdResponse<import("./services/ping.service").PingResult>>;
    getMediciones(id: string, horas: string, user: JwtPayload): Promise<StdResponse<MedicionNodo[]>>;
    getSnmpInterfaces(id: string, user: JwtPayload): Promise<StdResponse<any[]>>;
    testSnmp(id: string, user: JwtPayload): Promise<StdResponse<{
        conectado: boolean;
    }>>;
    getDashboard(user: JwtPayload): Promise<StdResponse<{
        nodos: {
            total: number;
            porEstado: Record<string, number>;
        };
        alertas: {
            activas: number;
            criticas: number;
            warnings: number;
            resueltasHoy: number;
        };
        websocket: {
            clientesConectados: number;
            porEmpresa: Record<string, number>;
            uptime: number;
        };
        cola: import("bull").JobCounts;
        timestamp: string;
    }>>;
    getAlertas(user: JwtPayload): Promise<StdResponse<import("./entities/monitoreo.entity").Alerta[]>>;
    getHistorialAlertas(nodoId: string, user: JwtPayload): Promise<StdResponse<import("./entities/monitoreo.entity").Alerta[]>>;
    resolverAlerta(id: string, body: {
        motivo?: string;
    }, user: JwtPayload): Promise<StdResponse<any>>;
    crearConfigAlerta(dto: CreateConfigAlertaDto, user: JwtPayload): Promise<StdResponse<ConfiguracionAlerta>>;
    getConfigAlertas(user: JwtPayload): Promise<StdResponse<ConfiguracionAlerta[]>>;
    deleteConfigAlerta(id: string, user: JwtPayload): Promise<void>;
    getWsStats(user: JwtPayload): Promise<StdResponse<{
        clientesConectados: number;
        porEmpresa: Record<string, number>;
        uptime: number;
    }>>;
    forzarScan(user: JwtPayload): Promise<StdResponse<{
        encolados: number;
    }>>;
}
export {};
