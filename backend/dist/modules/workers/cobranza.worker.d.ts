import { Job, Queue } from 'bull';
import { DataSource } from 'typeorm';
import { EventEmitter } from '@nestjs/event-emitter';
import { FirewallService } from '../mikrotik/services/firewall.service';
import { PppoeService } from '../mikrotik/services/pppoe.service';
import { WhatsAppService } from '../notificaciones/services/whatsapp.service';
import { FacturacionService } from '../facturacion/facturacion.service';
import { AuditoriaService } from '../auth/auditoria.service';
import { PayloadSuspenderContrato, PayloadReactivarContrato, PayloadEvaluarProrroga, PayloadProcesarPago } from './workers.constants';
export declare class CobranzaScheduler {
    private readonly queue;
    private readonly ds;
    private readonly logger;
    constructor(queue: Queue, ds: DataSource);
    detectarMorosos(): Promise<void>;
    verificarProrrogasVencidas(): Promise<void>;
    notificacionesPreventivas(): Promise<void>;
    enqueueReactivacion(payload: PayloadReactivarContrato): Promise<void>;
    enqueueProcesarPago(payload: PayloadProcesarPago): Promise<void>;
}
export declare class CobranzaWorker {
    private readonly firewallSvc;
    private readonly pppoeSvc;
    private readonly whatsappSvc;
    private readonly facturacionSvc;
    private readonly auditoria;
    private readonly events;
    private readonly ds;
    private readonly logger;
    constructor(firewallSvc: FirewallService, pppoeSvc: PppoeService, whatsappSvc: WhatsAppService, facturacionSvc: FacturacionService, auditoria: AuditoriaService, events: EventEmitter, ds: DataSource);
    processSuspenderContrato(job: Job<PayloadSuspenderContrato>): Promise<any>;
    processReactivarContrato(job: Job<PayloadReactivarContrato>): Promise<any>;
    processVencerProrroga(job: Job<PayloadEvaluarProrroga>): Promise<any>;
    processPago(job: Job<PayloadProcesarPago>): Promise<any>;
    processNotifCobro(job: Job): Promise<any>;
    onFailed(job: Job, error: Error): void;
    onCompleted(job: Job, result: any): void;
    onStalled(job: Job): void;
    private buildCreds;
    private enqueueCobranza;
}
