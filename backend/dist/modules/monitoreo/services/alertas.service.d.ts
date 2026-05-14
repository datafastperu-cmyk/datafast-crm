import { DataSource, Repository } from 'typeorm';
import { EventEmitter } from '@nestjs/event-emitter';
import { Alerta, ConfiguracionAlerta, MetricaAlerta, Nodo } from '../entities/monitoreo.entity';
import { WhatsAppService } from '../../notificaciones/services/whatsapp.service';
export declare const EVENTO_ALERTA_NUEVA = "monitoreo.alerta.nueva";
export declare const EVENTO_ALERTA_RESUELTA = "monitoreo.alerta.resuelta";
export declare const EVENTO_NODO_OFFLINE = "monitoreo.nodo.offline";
export declare const EVENTO_NODO_ONLINE = "monitoreo.nodo.online";
export interface MedicionParaEvaluar {
    nodoId: string;
    empresaId: string;
    nodoNombre: string;
    metrica: MetricaAlerta;
    valorActual: number;
    unidad?: string;
}
export declare class AlertasService {
    private readonly alertaRepo;
    private readonly configRepo;
    private readonly nodoRepo;
    private readonly whatsapp;
    private readonly events;
    private readonly ds;
    private readonly logger;
    constructor(alertaRepo: Repository<Alerta>, configRepo: Repository<ConfiguracionAlerta>, nodoRepo: Repository<Nodo>, whatsapp: WhatsAppService, events: EventEmitter, ds: DataSource);
    evaluar(medicion: MedicionParaEvaluar): Promise<void>;
    private evaluarUmbral;
    alertarNodoOffline(nodoId: string, empresaId: string, nodoNombre: string): Promise<void>;
    alertarNodoOnline(nodoId: string, empresaId: string, nodoNombre: string): Promise<void>;
    private crearAlerta;
    resolverAlerta(alertaId: string, motivo: string, resueltaPor?: string): Promise<void>;
    getAlertasActivas(empresaId: string): Promise<Alerta[]>;
    getHistorialAlertas(empresaId: string, nodoId?: string, limit?: number): Promise<Alerta[]>;
    getResumenAlertas(empresaId: string): Promise<{
        activas: number;
        criticas: number;
        warnings: number;
        resueltasHoy: number;
    }>;
    private construirMensaje;
    private formatBps;
}
