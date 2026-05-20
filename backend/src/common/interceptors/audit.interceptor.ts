import {
  Injectable, NestInterceptor, ExecutionContext,
  CallHandler, Logger,
} from '@nestjs/common';
import { Observable, from } from 'rxjs';
import { switchMap, tap } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Request } from 'express';
import { AuditoriaService } from '../../modules/auth/auditoria.service';
import { JwtPayload } from '../decorators/current-user.decorator';

export const SKIP_AUDIT_KEY = 'skipAudit';

// Módulo inferido desde la URL
const URL_MODULES: Array<{ pattern: RegExp; modulo: string }> = [
  { pattern: /\/clientes/,      modulo: 'clientes'    },
  { pattern: /\/contratos/,     modulo: 'contratos'   },
  { pattern: /\/facturas/,      modulo: 'facturacion' },
  { pattern: /\/pagos/,         modulo: 'pagos'       },
  { pattern: /\/planes/,        modulo: 'planes'      },
  { pattern: /\/mikrotik/,      modulo: 'red'         },
  { pattern: /\/onus/,          modulo: 'red'         },
  { pattern: /\/routers/,       modulo: 'red'         },
  { pattern: /\/nodos/,         modulo: 'monitoreo'   },
  { pattern: /\/tickets/,       modulo: 'soporte'     },
  { pattern: /\/usuarios/,      modulo: 'usuarios'    },
  { pattern: /\/roles/,         modulo: 'admin'       },
  { pattern: /\/auth/,          modulo: 'auth'        },
];

// Tablas rastreadas para undo/redo (path contiene → tabla)
const PATH_TABLA: Array<{ pattern: RegExp; tabla: string }> = [
  { pattern: /\/clientes/,     tabla: 'clientes'   },
  { pattern: /\/contratos/,    tabla: 'contratos'  },
  { pattern: /\/facturacion/,  tabla: 'facturas'   },
  { pattern: /\/facturas/,     tabla: 'facturas'   },
  { pattern: /\/pagos/,        tabla: 'pagos'      },
  { pattern: /\/planes/,       tabla: 'planes'     },
];

const METHOD_ACTION: Record<string, string> = {
  POST:   'CREATE',
  PUT:    'UPDATE',
  PATCH:  'UPDATE',
  DELETE: 'DELETE',
};

// Campos sensibles que nunca se guardan en snapshots
const SENSITIVE = new Set([
  'password', 'passwordHash', 'password_hash', 'refreshToken',
  'refresh_token_hash', 'token', 'secret',
]);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly auditoria: AuditoriaService,
    @InjectDataSource()
    private readonly ds: DataSource,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();

    const req: Request = context.switchToHttp().getRequest();
    const method = req.method;
    const accion = METHOD_ACTION[method];
    if (!accion) return next.handle();

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_AUDIT_KEY, [
      context.getHandler(), context.getClass(),
    ]);
    if (skip) return next.handle();

    const user        = req['user'] as JwtPayload;
    const modulo      = this.inferirModulo(req.path);
    const tabla       = this.inferirTabla(req.path);
    const entidadId   = req.params?.id;
    const startTime   = Date.now();

    // Para UPDATE/DELETE con ID conocido y tabla rastreable → capturar snapshot previo
    const needsSnapshot = tabla && entidadId &&
      (method === 'PUT' || method === 'PATCH' || method === 'DELETE');

    const snapshotPromise: Promise<Record<string, any> | null> = needsSnapshot
      ? this.ds.query(`SELECT * FROM ${tabla} WHERE id = $1`, [entidadId])
          .then(rows => rows[0] ? this.sanitize(rows[0]) : null)
          .catch(() => null)
      : Promise.resolve(null);

    return from(snapshotPromise).pipe(
      switchMap(snapshotAnterior =>
        next.handle().pipe(
          tap({
            next: (responseData) => {
              const duracion      = Date.now() - startTime;
              const entidadIdFinal = entidadId ?? responseData?.data?.id ?? responseData?.id;

              // Log de auditoría base (no bloquea)
              this.auditoria.log({
                empresaId:    user?.empresaId,
                usuarioId:    user?.sub,
                usuarioEmail: user?.email,
                accion,
                modulo,
                entidadId:    entidadIdFinal,
                descripcion:  `${method} ${req.path} (${duracion}ms)`,
                req,
                datosAnteriores: snapshotAnterior ?? undefined,
                datosNuevos:     entidadIdFinal
                  ? { id: entidadIdFinal }
                  : undefined,
              }).catch(err => this.logger.error(`Audit log: ${err.message}`));

              // Versión de entidad para undo/redo (solo tablas rastreadas)
              if (tabla && entidadIdFinal && user?.sub) {
                this.saveEntityVersion({
                  tabla, modulo, accion, user,
                  entidadId:       entidadIdFinal,
                  snapshotAnterior,
                  responseData,
                }).catch(err => this.logger.error(`EntityVersion: ${err.message}`));
              }
            },
          }),
        ),
      ),
    );
  }

  private async saveEntityVersion(params: {
    tabla:           string;
    modulo:          string;
    accion:          string;
    user:            JwtPayload;
    entidadId:       string;
    snapshotAnterior: Record<string, any> | null;
    responseData:    any;
  }) {
    const { tabla, modulo, accion, user, entidadId, snapshotAnterior } = params;

    // Para CREATE capturar el snapshot creado (consulta post-insert)
    let snapshotPosterior: Record<string, any> | null = null;
    if (accion === 'CREATE' && entidadId) {
      try {
        const [row] = await this.ds.query(
          `SELECT * FROM ${tabla} WHERE id = $1`, [entidadId],
        );
        snapshotPosterior = row ? this.sanitize(row) : null;
      } catch { /* omitir */ }
    }

    const descripcion = `${accion} en ${modulo} (id: ${entidadId?.slice(0, 8)}...)`;

    await this.ds.query(
      `INSERT INTO entity_versions
         (empresa_id, usuario_id, usuario_email, modulo, tabla, entidad_id,
          accion, snapshot_anterior, snapshot_posterior, descripcion, reversible)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        user.empresaId,
        user.sub,
        user.email,
        modulo,
        tabla,
        entidadId,
        accion,
        snapshotAnterior ? JSON.stringify(snapshotAnterior) : null,
        snapshotPosterior ? JSON.stringify(snapshotPosterior) : null,
        descripcion,
        true,
      ],
    );
  }

  private inferirModulo(path: string): string {
    for (const { pattern, modulo } of URL_MODULES) {
      if (pattern.test(path)) return modulo;
    }
    return 'sistema';
  }

  private inferirTabla(path: string): string | null {
    for (const { pattern, tabla } of PATH_TABLA) {
      if (pattern.test(path)) return tabla;
    }
    return null;
  }

  private sanitize(data: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) {
      result[k] = SENSITIVE.has(k) ? '[REDACTED]' : v;
    }
    return result;
  }
}
