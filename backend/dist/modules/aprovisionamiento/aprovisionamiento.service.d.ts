import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WhatsAppService } from '../notificaciones/services/whatsapp.service';
import { PppoeService } from '../mikrotik/services/pppoe.service';
import { QueueService } from '../mikrotik/services/queue.service';
import { FirewallService } from '../mikrotik/services/firewall.service';
import { VelocidadOrquestador } from '../mikrotik/services/velocidad/velocidad-orquestador.service';
import { SmartoltApiService } from '../smartolt/smartolt-api.service';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { AprovisionarFtthDto, RollbackAprovisionamientoDto, AprovisionamientoResultadoDto, PasoResultadoDto } from './aprovisionamiento.dto';
interface Ctx {
    contrato?: any;
    cliente?: any;
    plan?: any;
    router?: any;
    olt?: any;
    ipAsignada?: string;
    usuarioPppoe?: string;
    passwordPppoePlain?: string;
    serialNumber?: string;
    onuId?: string;
    smartoltOnuId?: string;
    ipRegistradaEnBd: boolean;
    pppoeCreado: boolean;
    queueCreada: boolean;
    onuAprovisionada: boolean;
    onuRegistradaEnBd: boolean;
    contratoActivado: boolean;
}
export declare class OrquestadorAprovisionamientoService {
    private readonly pppoeSvc;
    private readonly queueSvc;
    private readonly firewallSvc;
    private readonly velocidadOrc;
    private readonly smartoltApi;
    private readonly whatsapp;
    private readonly events;
    private readonly ds;
    private readonly logger;
    constructor(pppoeSvc: PppoeService, queueSvc: QueueService, firewallSvc: FirewallService, velocidadOrc: VelocidadOrquestador, smartoltApi: SmartoltApiService, whatsapp: WhatsAppService, events: EventEmitter2, ds: DataSource);
    ejecutar(dto: AprovisionarFtthDto, user: JwtPayload): Promise<AprovisionamientoResultadoDto>;
    ejecutarRollback(dto: RollbackAprovisionamientoDto, ctx?: Ctx, user?: JwtPayload, pasos?: PasoResultadoDto[]): Promise<{
        revertidos: string[];
        errores: string[];
    }>;
    private buildRouterCreds;
}
export {};
