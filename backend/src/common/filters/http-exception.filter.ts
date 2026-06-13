import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { QueryFailedError, EntityNotFoundError, OptimisticLockVersionMismatchError } from 'typeorm';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') return;

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Error interno del servidor';
    let errors: any = null;
    let code = 'INTERNAL_ERROR';

    // ── Excepciones HTTP de NestJS ────────────────────────────
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const resp = exceptionResponse as any;
        message = resp.message || resp.error || message;
        // Propagar código explícito si la excepción lo incluye (ej. CONCURRENCY_CONFLICT)
        if (resp.code) code = resp.code;
        // Errores de validación (class-validator)
        if (Array.isArray(resp.message)) {
          errors = resp.message;
          message = 'Error de validación — revisa los campos enviados';
          code = 'VALIDATION_ERROR';
        }
      }

    // ── Errores de base de datos (TypeORM) ────────────────────
    } else if (exception instanceof QueryFailedError) {
      const pgError = exception as any;
      status = HttpStatus.BAD_REQUEST;
      code = 'DATABASE_ERROR';

      // Violación de unique constraint
      if (pgError.code === '23505') {
        message = 'Ya existe un registro con esos datos (duplicado)';
        code = 'DUPLICATE_ENTRY';
        // Extraer el campo duplicado del detalle del error
        const detail = pgError.detail || '';
        const fieldMatch = detail.match(/\((.+)\)=/);
        if (fieldMatch) {
          errors = { field: fieldMatch[1], message: 'Valor duplicado' };
        }
      }
      // Violación de foreign key
      else if (pgError.code === '23503') {
        message = 'El registro referenciado no existe';
        code = 'FOREIGN_KEY_VIOLATION';
      }
      // Violación de not null
      else if (pgError.code === '23502') {
        message = `El campo '${pgError.column}' es requerido`;
        code = 'NULL_VIOLATION';
      }
      // Tipo de dato incorrecto
      else if (pgError.code === '22P02') {
        message = 'Formato de dato inválido';
        code = 'INVALID_DATA_TYPE';
      }
      // Violación de check constraint (ej: vlan_id fuera de rango, descuento fuera de 0-100)
      else if (pgError.code === '23514') {
        message = `Valor fuera de rango permitido${pgError.constraint ? ` (${pgError.constraint})` : ''}`;
        code = 'CHECK_VIOLATION';
      }
      // Columna o tabla no encontrada — generalmente indica migración pendiente
      else if (pgError.code === '42703' || pgError.code === '42P01') {
        message = 'Error de esquema en base de datos — puede haber migraciones pendientes';
        code = 'SCHEMA_ERROR';
        this.logger.error(`SCHEMA ERROR ${pgError.code}: ${pgError.message}`, pgError.stack);
      } else {
        message = 'Error en la base de datos';
        this.logger.error(`DB Error ${pgError.code}: ${pgError.message}`, pgError.stack);
      }

    } else if (exception instanceof OptimisticLockVersionMismatchError) {
      status = HttpStatus.CONFLICT;
      code = 'CONCURRENCY_CONFLICT';
      message = 'Los datos fueron modificados por otro usuario. Por favor, recargue la página e intente nuevamente.';

    } else if (exception instanceof EntityNotFoundError) {
      status = HttpStatus.NOT_FOUND;
      message = 'Registro no encontrado';
      code = 'NOT_FOUND';

    // ── Errores genéricos ─────────────────────────────────────
    } else if (exception instanceof Error) {
      this.logger.error(
        `Unhandled exception: ${exception.message}`,
        exception.stack,
        { url: request.url, method: request.method },
      );
      // En producción no exponer detalles internos
      message =
        process.env.NODE_ENV === 'production'
          ? 'Error interno del servidor'
          : exception.message;
    }

    const errorResponse = {
      success: false,
      statusCode: status,
      code,
      message,
      errors,
      path: request.url,
      method: request.method,
      timestamp: new Date().toISOString(),
      requestId: request.headers['x-request-id'] || null,
    };

    // Log de todos los errores 5xx
    if (status >= 500) {
      this.logger.error(
        `${status} ${request.method} ${request.url} — ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(status).json(errorResponse);
  }
}
