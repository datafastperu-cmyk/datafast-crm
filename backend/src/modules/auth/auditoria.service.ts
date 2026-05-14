import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { AuditoriaLog } from '../usuarios/entities/auditoria-log.entity';

export interface AuditParams {
  empresaId?: string;
  usuarioId?: string;
  usuarioEmail?: string;
  accion: string;       // 'LOGIN' | 'LOGOUT' | 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN_FAIL'
  modulo: string;       // 'auth' | 'clientes' | 'pagos' | ...
  entidadId?: string;
  descripcion?: string;
  req?: Request;
  datosAnteriores?: Record<string, any>;
  datosNuevos?: Record<string, any>;
}

@Injectable()
export class AuditoriaService {
  private readonly logger = new Logger(AuditoriaService.name);

  constructor(
    @InjectRepository(AuditoriaLog)
    private readonly logRepo: Repository<AuditoriaLog>,
  ) {}

  // ── Registrar acción en el log de auditoría ───────────────
  async log(params: AuditParams): Promise<void> {
    try {
      const entry = this.logRepo.create({
        empresaId:       params.empresaId,
        usuarioId:       params.usuarioId,
        usuarioEmail:    params.usuarioEmail,
        accion:          params.accion,
        modulo:          params.modulo,
        entidadId:       params.entidadId,
        descripcion:     params.descripcion,
        datosAnteriores: this.sanitize(params.datosAnteriores),
        datosNuevos:     this.sanitize(params.datosNuevos),
        ipAddress:       params.req ? this.getIp(params.req) : undefined,
        userAgent:       params.req?.get('user-agent')?.substring(0, 300),
        metodoHttp:      params.req?.method,
        ruta:            params.req?.path,
      });

      // Guardar sin await para no bloquear el request principal
      this.logRepo.save(entry).catch((err) =>
        this.logger.error(`Error guardando log de auditoría: ${err.message}`),
      );
    } catch (err) {
      // El log nunca debe romper el flujo principal
      this.logger.error(`AuditoriaService.log failed: ${err.message}`);
    }
  }

  // ── Shortcuts ─────────────────────────────────────────────
  async logLogin(params: Omit<AuditParams, 'accion' | 'modulo'> & { exitoso: boolean }): Promise<void> {
    return this.log({
      ...params,
      accion: params.exitoso ? 'LOGIN' : 'LOGIN_FAIL',
      modulo: 'auth',
    });
  }

  async logLogout(params: Omit<AuditParams, 'accion' | 'modulo'>): Promise<void> {
    return this.log({ ...params, accion: 'LOGOUT', modulo: 'auth' });
  }

  async logCreate(params: Omit<AuditParams, 'accion'>): Promise<void> {
    return this.log({ ...params, accion: 'CREATE' });
  }

  async logUpdate(params: Omit<AuditParams, 'accion'>): Promise<void> {
    return this.log({ ...params, accion: 'UPDATE' });
  }

  async logDelete(params: Omit<AuditParams, 'accion'>): Promise<void> {
    return this.log({ ...params, accion: 'DELETE' });
  }

  // ── Obtener IP real considerando proxies ─────────────────
  private getIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'] as string;
    if (forwarded) return forwarded.split(',')[0].trim();
    return req.ip || req.connection?.remoteAddress || 'unknown';
  }

  // ── Sanitizar datos sensibles antes de guardar ────────────
  private sanitize(data?: Record<string, any>): Record<string, any> | undefined {
    if (!data) return undefined;

    const sensitiveFields = [
      'password', 'passwordHash', 'password_hash',
      'refreshToken', 'refreshTokenHash', 'refresh_token_hash',
      'token', 'secret', 'clave', 'claveSecreta',
      'passwordCifrado', 'password_cifrado',
      'creditCard', 'cvv', 'pin',
    ];

    const sanitized = { ...data };
    for (const field of sensitiveFields) {
      if (field in sanitized) {
        sanitized[field] = '[REDACTED]';
      }
    }
    return sanitized;
  }

  // ── Consultar historial de un usuario ─────────────────────
  async getHistorialUsuario(
    usuarioId: string,
    empresaId: string,
    limit = 50,
  ): Promise<AuditoriaLog[]> {
    return this.logRepo.find({
      where: { usuarioId, empresaId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  // ── Consultar logs de una entidad ─────────────────────────
  async getHistorialEntidad(
    entidadId: string,
    empresaId: string,
  ): Promise<AuditoriaLog[]> {
    return this.logRepo.find({
      where: { entidadId, empresaId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }
}
