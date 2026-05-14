import { Queue } from 'bull';
import { CobranzaScheduler } from './cobranza.worker';
import { FacturacionScheduler } from './facturacion.worker';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { ApiResponse } from '../../common/dto/response.dto';
declare class TriggerFacturacionDto {
    mes?: number;
    anio?: number;
    forzar?: boolean;
}
export declare class WorkersController {
    private readonly cobranzaQueue;
    private readonly facturacionQueue;
    private readonly cobranzaSched;
    private readonly facturacionSched;
    private readonly logger;
    constructor(cobranzaQueue: Queue, facturacionQueue: Queue, cobranzaSched: CobranzaScheduler, facturacionSched: FacturacionScheduler);
    getStatus(): Promise<ApiResponse<{
        cobranza: {
            nombre: "cobranza";
            active: number;
            completed: number;
            failed: number;
            delayed: number;
            waiting: number;
        };
        facturacion: {
            nombre: "facturacion";
            active: number;
            completed: number;
            failed: number;
            delayed: number;
            waiting: number;
        };
        timestamp: string;
    }>>;
    getJobs(cola: string, estado: string): Promise<ApiResponse<{
        id: any;
        name: any;
        state: string;
        data: any;
        progress: any;
        attemptsMade: any;
        timestamp: any;
        processedOn: any;
        finishedOn: any;
        failedReason: any;
    }[]>>;
    triggerFacturacion(dto: TriggerFacturacionDto, user: JwtPayload): Promise<ApiResponse<{
        jobId: string;
        mes: number;
        anio: number;
        empresaId: string;
    }>>;
    triggerCobranza(user: JwtPayload): Promise<ApiResponse<any>>;
    cleanQueues(user: JwtPayload): Promise<ApiResponse<any>>;
    retryFailed(cola: string, user: JwtPayload): Promise<ApiResponse<{
        reintentados: number;
    }>>;
}
export {};
