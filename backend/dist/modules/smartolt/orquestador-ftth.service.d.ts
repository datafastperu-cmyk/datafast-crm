import { DataSource } from 'typeorm';
import { EventEmitter } from '@nestjs/event-emitter';
import { SmartoltService } from './smartolt.service';
import { SmartoltApiService } from './smartolt-api.service';
import { MikrotikService } from '../mikrotik/mikrotik.service';
import { PppoeService } from '../mikrotik/services/pppoe.service';
import { VelocidadOrquestador } from '../mikrotik/services/velocidad/velocidad-orquestador.service';
import { FirewallService } from '../mikrotik/services/firewall.service';
import { AuditoriaService } from '../auth/auditoria.service';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { FlujoComipletoFtthDto, FlujoComipletoResultadoDto } from './dto/smartolt.dto';
export declare class OrquestadorFtthService {
    private readonly smartoltSvc;
    private readonly smartoltApi;
    private readonly mikrotikSvc;
    private readonly pppoeSvc;
    private readonly velocidadOrc;
    private readonly firewallSvc;
    private readonly auditoria;
    private readonly events;
    private readonly ds;
    private readonly logger;
    constructor(smartoltSvc: SmartoltService, smartoltApi: SmartoltApiService, mikrotikSvc: MikrotikService, pppoeSvc: PppoeService, velocidadOrc: VelocidadOrquestador, firewallSvc: FirewallService, auditoria: AuditoriaService, events: EventEmitter, ds: DataSource);
    ejecutarFlujoComipletoFtth(dto: FlujoComipletoFtthDto, user: JwtPayload): Promise<FlujoComipletoResultadoDto>;
}
