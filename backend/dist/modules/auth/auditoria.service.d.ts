import { Repository } from 'typeorm';
import { Request } from 'express';
import { AuditoriaLog } from '../usuarios/entities/auditoria-log.entity';
export interface AuditParams {
    empresaId?: string;
    usuarioId?: string;
    usuarioEmail?: string;
    accion: string;
    modulo: string;
    entidadId?: string;
    descripcion?: string;
    req?: Request;
    datosAnteriores?: Record<string, any>;
    datosNuevos?: Record<string, any>;
}
export declare class AuditoriaService {
    private readonly logRepo;
    private readonly logger;
    constructor(logRepo: Repository<AuditoriaLog>);
    log(params: AuditParams): Promise<void>;
    logLogin(params: Omit<AuditParams, 'accion' | 'modulo'> & {
        exitoso: boolean;
    }): Promise<void>;
    logLogout(params: Omit<AuditParams, 'accion' | 'modulo'>): Promise<void>;
    logCreate(params: Omit<AuditParams, 'accion'>): Promise<void>;
    logUpdate(params: Omit<AuditParams, 'accion'>): Promise<void>;
    logDelete(params: Omit<AuditParams, 'accion'>): Promise<void>;
    private getIp;
    private sanitize;
    getHistorialUsuario(usuarioId: string, empresaId: string, limit?: number): Promise<AuditoriaLog[]>;
    getHistorialEntidad(entidadId: string, empresaId: string): Promise<AuditoriaLog[]>;
}
