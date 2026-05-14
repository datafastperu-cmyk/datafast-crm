"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var AllExceptionsFilter_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AllExceptionsFilter = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("typeorm");
let AllExceptionsFilter = AllExceptionsFilter_1 = class AllExceptionsFilter {
    constructor() {
        this.logger = new common_1.Logger(AllExceptionsFilter_1.name);
    }
    catch(exception, host) {
        if (host.getType() !== 'http')
            return;
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();
        const request = ctx.getRequest();
        let status = common_1.HttpStatus.INTERNAL_SERVER_ERROR;
        let message = 'Error interno del servidor';
        let errors = null;
        let code = 'INTERNAL_ERROR';
        if (exception instanceof common_1.HttpException) {
            status = exception.getStatus();
            const exceptionResponse = exception.getResponse();
            if (typeof exceptionResponse === 'string') {
                message = exceptionResponse;
            }
            else if (typeof exceptionResponse === 'object') {
                const resp = exceptionResponse;
                message = resp.message || resp.error || message;
                if (Array.isArray(resp.message)) {
                    errors = resp.message;
                    message = 'Error de validación — revisa los campos enviados';
                    code = 'VALIDATION_ERROR';
                }
            }
        }
        else if (exception instanceof typeorm_1.QueryFailedError) {
            const pgError = exception;
            status = common_1.HttpStatus.BAD_REQUEST;
            code = 'DATABASE_ERROR';
            if (pgError.code === '23505') {
                message = 'Ya existe un registro con esos datos (duplicado)';
                code = 'DUPLICATE_ENTRY';
                const detail = pgError.detail || '';
                const fieldMatch = detail.match(/\((.+)\)=/);
                if (fieldMatch) {
                    errors = { field: fieldMatch[1], message: 'Valor duplicado' };
                }
            }
            else if (pgError.code === '23503') {
                message = 'El registro referenciado no existe';
                code = 'FOREIGN_KEY_VIOLATION';
            }
            else if (pgError.code === '23502') {
                message = `El campo '${pgError.column}' es requerido`;
                code = 'NULL_VIOLATION';
            }
            else if (pgError.code === '22P02') {
                message = 'Formato de dato inválido';
                code = 'INVALID_DATA_TYPE';
            }
            else {
                message = 'Error en la base de datos';
                this.logger.error(`DB Error ${pgError.code}: ${pgError.message}`, pgError.stack);
            }
        }
        else if (exception instanceof typeorm_1.EntityNotFoundError) {
            status = common_1.HttpStatus.NOT_FOUND;
            message = 'Registro no encontrado';
            code = 'NOT_FOUND';
        }
        else if (exception instanceof Error) {
            this.logger.error(`Unhandled exception: ${exception.message}`, exception.stack, { url: request.url, method: request.method });
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
        if (status >= 500) {
            this.logger.error(`${status} ${request.method} ${request.url} — ${message}`, exception instanceof Error ? exception.stack : undefined);
        }
        response.status(status).json(errorResponse);
    }
};
exports.AllExceptionsFilter = AllExceptionsFilter;
exports.AllExceptionsFilter = AllExceptionsFilter = AllExceptionsFilter_1 = __decorate([
    (0, common_1.Catch)()
], AllExceptionsFilter);
//# sourceMappingURL=http-exception.filter.js.map