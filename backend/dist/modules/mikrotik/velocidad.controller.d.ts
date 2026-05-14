import { VelocidadOrquestador } from './services/velocidad/velocidad-orquestador.service';
import { VelocidadService } from './services/velocidad/velocidad.service';
import { MikrotikService } from './mikrotik.service';
import { VelocidadScheduler } from './velocidad.worker';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { ApiResponse as StdResponse } from '../../common/dto/response.dto';
declare class AplicarVelocidadDto {
    clienteId: string;
    usuarioPppoe: string;
    ipAsignada: string;
    downloadMbps: number;
    uploadMbps: number;
    burstDownMbps?: number;
    burstUpMbps?: number;
    burstTiempoSeg?: number;
    tipoQueuePlan?: string;
    tipoPlan?: string;
    wanIface?: string;
}
declare class CambiarVelocidadDto {
    clienteId: string;
    usuarioPppoe: string;
    downloadMbps: number;
    uploadMbps: number;
    prioridad?: number;
}
export declare class VelocidadController {
    private readonly orquestador;
    private readonly velocidadSvc;
    private readonly mikrotikSvc;
    private readonly scheduler;
    private readonly logger;
    constructor(orquestador: VelocidadOrquestador, velocidadSvc: VelocidadService, mikrotikSvc: MikrotikService, scheduler: VelocidadScheduler);
    aplicar(routerId: string, dto: AplicarVelocidadDto, user: JwtPayload): Promise<StdResponse<import("./services/velocidad/velocidad-orquestador.service").ResultadoVelocidad>>;
    cambiar(routerId: string, dto: CambiarVelocidadDto, user: JwtPayload): Promise<StdResponse<{
        actualizado: boolean;
        metodo: string;
        detalle: string;
    }>>;
    getCapacidad(routerId: string, user: JwtPayload): Promise<StdResponse<import("./services/velocidad/velocidad.service").CapacidadRouter>>;
    sincronizar(routerId: string, user: JwtPayload): Promise<StdResponse<import("./services/velocidad/velocidad-orquestador.service").ResultadoSincronizacion>>;
    encolarSincronizacion(routerId: string, user: JwtPayload): Promise<StdResponse<any>>;
    getDiscrepancias(routerId: string, user: JwtPayload): Promise<StdResponse<{
        nombre: string;
        actual: string;
        esperado: string;
    }[]>>;
    private buildCreds;
}
export {};
