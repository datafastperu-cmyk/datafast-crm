import { NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Reflector } from '@nestjs/core';
import { AuditoriaService } from '../../modules/auth/auditoria.service';
export declare const SKIP_AUDIT_KEY = "skipAudit";
export declare class AuditInterceptor implements NestInterceptor {
    private readonly reflector;
    private readonly auditoria;
    private readonly logger;
    private readonly METHOD_ACTION;
    private readonly URL_MODULES;
    constructor(reflector: Reflector, auditoria: AuditoriaService);
    intercept(context: ExecutionContext, next: CallHandler): Observable<any>;
    private inferirModulo;
    private extractSafeParams;
}
