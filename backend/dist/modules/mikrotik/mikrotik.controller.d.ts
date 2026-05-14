import { MikrotikService } from './mikrotik.service';
import { CreateRouterDto, UpdateRouterDto, ProvisionarClienteDto, SuspenderClienteDto, ReactivarClienteDto, DhcpBindingDto, ActualizarQueueDto, PingDto } from './dto/mikrotik.dto';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { ApiResponse as StdResponse } from '../../common/dto/response.dto';
export declare class MikrotikController {
    private readonly svc;
    private readonly logger;
    constructor(svc: MikrotikService);
    crearRouter(dto: CreateRouterDto, user: JwtPayload): Promise<StdResponse<import("./entities/router.entity").Router>>;
    listarRouters(user: JwtPayload): Promise<StdResponse<import("./entities/router.entity").Router[]>>;
    getRouter(id: string, user: JwtPayload): Promise<StdResponse<import("./entities/router.entity").Router>>;
    updateRouter(id: string, dto: UpdateRouterDto, user: JwtPayload): Promise<StdResponse<import("./entities/router.entity").Router>>;
    removeRouter(id: string, user: JwtPayload): Promise<void>;
    getEstado(id: string, user: JwtPayload): Promise<StdResponse<{
        router: import("./entities/router.entity").Router;
        recursos: any;
        interfaces: any[];
        sesionesActivas: number;
        version: string;
    }>>;
    testConexion(id: string, user: JwtPayload): Promise<StdResponse<{
        exitoso: boolean;
        mensaje: string;
        latenciaMs?: number;
    }>>;
    getInterfaces(id: string, user: JwtPayload): Promise<StdResponse<any[]>>;
    getTrafico(id: string, iface: string, user: JwtPayload): Promise<StdResponse<any[]>>;
    getSesiones(id: string, user: JwtPayload): Promise<StdResponse<any[]>>;
    getMorosos(id: string, user: JwtPayload): Promise<StdResponse<any[]>>;
    getQueues(id: string, user: JwtPayload): Promise<StdResponse<any[]>>;
    getDhcp(id: string, user: JwtPayload): Promise<StdResponse<any[]>>;
    provisionar(id: string, dto: ProvisionarClienteDto, user: JwtPayload): Promise<StdResponse<{
        ppppoeId: string;
        queueId: string;
    }>>;
    suspender(id: string, dto: SuspenderClienteDto, user: JwtPayload): Promise<StdResponse<any>>;
    reactivar(id: string, dto: ReactivarClienteDto, user: JwtPayload): Promise<StdResponse<any>>;
    crearDhcpBinding(id: string, dto: DhcpBindingDto, user: JwtPayload): Promise<StdResponse<{
        mensaje: string;
    }>>;
    actualizarQueue(id: string, dto: ActualizarQueueDto, user: JwtPayload): Promise<StdResponse<any>>;
    configurarFirewall(id: string, user: JwtPayload): Promise<StdResponse<any>>;
    ping(id: string, dto: PingDto, user: JwtPayload): Promise<StdResponse<any>>;
}
