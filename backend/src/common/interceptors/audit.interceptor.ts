import {
  Injectable, NestInterceptor, ExecutionContext,
  CallHandler, Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuditoriaService } from '../../modules/auth/auditoria.service';
import { JwtPayload } from '../decorators/current-user.decorator';

// Metadato para marcar endpoints que no deben auditarse
export const SKIP_AUDIT_KEY = 'skipAudit';

// ─── Interceptor de auditoría automática ─────────────────────
// Registra automáticamente POST, PUT, PATCH, DELETE en el log.
// GET no se audita por defecto (demasiado ruido).
// Uso en controller: @SetMetadata('skipAudit', true) para saltar.
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  // Mapeo de método HTTP → acción de auditoría
  private readonly METHOD_ACTION: Record<string, string> = {
    POST:   'CREATE',
    PUT:    'UPDATE',
    PATCH:  'UPDATE',
    DELETE: 'DELETE',
  };

  // Módulos inferidos desde la URL
  private readonly URL_MODULES: Array<{ pattern: RegExp; modulo: string }> = [
    { pattern: /\/clientes/,      modulo: 'clientes' },
    { pattern: /\/contratos/,     modulo: 'contratos' },
    { pattern: /\/facturas/,      modulo: 'facturacion' },
    { pattern: /\/pagos/,         modulo: 'pagos' },
    { pattern: /\/planes/,        modulo: 'planes' },
    { pattern: /\/mikrotik/,      modulo: 'red' },
    { pattern: /\/onus/,          modulo: 'red' },
    { pattern: /\/routers/,       modulo: 'red' },
    { pattern: /\/nodos/,         modulo: 'monitoreo' },
    { pattern: /\/tickets/,       modulo: 'soporte' },
    { pattern: /\/ordenes/,       modulo: 'soporte' },
    { pattern: /\/usuarios/,      modulo: 'usuarios' },
    { pattern: /\/roles/,         modulo: 'admin' },
    { pattern: /\/auth/,          modulo: 'auth' },
  ];

  constructor(
    private readonly reflector: Reflector,
    private readonly auditoria: AuditoriaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();

    const req: Request = context.switchToHttp().getRequest();
    const method = req.method;

    // Solo auditar mutaciones
    const accion = this.METHOD_ACTION[method];
    if (!accion) return next.handle();

    // Verificar si el handler tiene @SetMetadata('skipAudit', true)
    const skipAudit = this.reflector.getAllAndOverride<boolean>(SKIP_AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skipAudit) return next.handle();

    const user = req['user'] as JwtPayload;
    const modulo = this.inferirModulo(req.path);
    const entidadId = req.params?.id;
    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: (responseData) => {
          // Extraer ID si fue un CREATE (el response suele tener el objeto creado)
          const entidadIdFinal =
            entidadId ||
            responseData?.data?.id ||
            responseData?.id;

          const duracion = Date.now() - startTime;

          this.auditoria.log({
            empresaId:    user?.empresaId,
            usuarioId:    user?.sub,
            usuarioEmail: user?.email,
            accion,
            modulo,
            entidadId:    entidadIdFinal,
            descripcion:  `${method} ${req.path} (${duracion}ms)`,
            req,
            // No guardar body completo (puede tener passwords, datos sensibles)
            // Solo guardar params relevantes
            datosNuevos: entidadId
              ? { id: entidadId, ...this.extractSafeParams(req.params) }
              : undefined,
          }).catch((err) =>
            this.logger.error(`Audit log failed: ${err.message}`),
          );
        },
        error: () => {
          // Errores se loggean en el ExceptionFilter, no aquí
        },
      }),
    );
  }

  private inferirModulo(path: string): string {
    for (const { pattern, modulo } of this.URL_MODULES) {
      if (pattern.test(path)) return modulo;
    }
    return 'sistema';
  }

  private extractSafeParams(params: Record<string, string>): Record<string, string> {
    // Filtrar params que podrían ser sensibles
    const safe: Record<string, string> = {};
    const allowedParams = ['id', 'clienteId', 'contratoId', 'facturaId'];
    for (const key of allowedParams) {
      if (params[key]) safe[key] = params[key];
    }
    return safe;
  }
}
