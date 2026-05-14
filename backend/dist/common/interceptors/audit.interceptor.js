"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var AuditInterceptor_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditInterceptor = exports.SKIP_AUDIT_KEY = void 0;
const common_1 = require("@nestjs/common");
const operators_1 = require("rxjs/operators");
const core_1 = require("@nestjs/core");
const auditoria_service_1 = require("../../modules/auth/auditoria.service");
exports.SKIP_AUDIT_KEY = 'skipAudit';
let AuditInterceptor = AuditInterceptor_1 = class AuditInterceptor {
    constructor(reflector, auditoria) {
        this.reflector = reflector;
        this.auditoria = auditoria;
        this.logger = new common_1.Logger(AuditInterceptor_1.name);
        this.METHOD_ACTION = {
            POST: 'CREATE',
            PUT: 'UPDATE',
            PATCH: 'UPDATE',
            DELETE: 'DELETE',
        };
        this.URL_MODULES = [
            { pattern: /\/clientes/, modulo: 'clientes' },
            { pattern: /\/contratos/, modulo: 'contratos' },
            { pattern: /\/facturas/, modulo: 'facturacion' },
            { pattern: /\/pagos/, modulo: 'pagos' },
            { pattern: /\/planes/, modulo: 'planes' },
            { pattern: /\/mikrotik/, modulo: 'red' },
            { pattern: /\/onus/, modulo: 'red' },
            { pattern: /\/routers/, modulo: 'red' },
            { pattern: /\/nodos/, modulo: 'monitoreo' },
            { pattern: /\/tickets/, modulo: 'soporte' },
            { pattern: /\/ordenes/, modulo: 'soporte' },
            { pattern: /\/usuarios/, modulo: 'usuarios' },
            { pattern: /\/roles/, modulo: 'admin' },
            { pattern: /\/auth/, modulo: 'auth' },
        ];
    }
    intercept(context, next) {
        if (context.getType() !== 'http')
            return next.handle();
        const req = context.switchToHttp().getRequest();
        const method = req.method;
        const accion = this.METHOD_ACTION[method];
        if (!accion)
            return next.handle();
        const skipAudit = this.reflector.getAllAndOverride(exports.SKIP_AUDIT_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (skipAudit)
            return next.handle();
        const user = req['user'];
        const modulo = this.inferirModulo(req.path);
        const entidadId = req.params?.id;
        const startTime = Date.now();
        return next.handle().pipe((0, operators_1.tap)({
            next: (responseData) => {
                const entidadIdFinal = entidadId ||
                    responseData?.data?.id ||
                    responseData?.id;
                const duracion = Date.now() - startTime;
                this.auditoria.log({
                    empresaId: user?.empresaId,
                    usuarioId: user?.sub,
                    usuarioEmail: user?.email,
                    accion,
                    modulo,
                    entidadId: entidadIdFinal,
                    descripcion: `${method} ${req.path} (${duracion}ms)`,
                    req,
                    datosNuevos: entidadId
                        ? { id: entidadId, ...this.extractSafeParams(req.params) }
                        : undefined,
                }).catch((err) => this.logger.error(`Audit log failed: ${err.message}`));
            },
            error: () => {
            },
        }));
    }
    inferirModulo(path) {
        for (const { pattern, modulo } of this.URL_MODULES) {
            if (pattern.test(path))
                return modulo;
        }
        return 'sistema';
    }
    extractSafeParams(params) {
        const safe = {};
        const allowedParams = ['id', 'clienteId', 'contratoId', 'facturaId'];
        for (const key of allowedParams) {
            if (params[key])
                safe[key] = params[key];
        }
        return safe;
    }
};
exports.AuditInterceptor = AuditInterceptor;
exports.AuditInterceptor = AuditInterceptor = AuditInterceptor_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.Reflector,
        auditoria_service_1.AuditoriaService])
], AuditInterceptor);
//# sourceMappingURL=audit.interceptor.js.map