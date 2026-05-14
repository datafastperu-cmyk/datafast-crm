"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoggingInterceptor = void 0;
const common_1 = require("@nestjs/common");
const operators_1 = require("rxjs/operators");
let LoggingInterceptor = class LoggingInterceptor {
    constructor() {
        this.logger = new common_1.Logger('HTTP');
    }
    intercept(context, next) {
        if (context.getType() !== 'http')
            return next.handle();
        const req = context.switchToHttp().getRequest();
        const res = context.switchToHttp().getResponse();
        const { method, url, ip } = req;
        const userAgent = req.get('user-agent') || '';
        const userId = req.user?.id || 'anonymous';
        const startTime = Date.now();
        const skipPaths = ['/health', '/metrics', '/_next'];
        if (skipPaths.some((p) => url.startsWith(p))) {
            return next.handle();
        }
        return next.handle().pipe((0, operators_1.tap)(() => {
            const duration = Date.now() - startTime;
            const statusCode = res.statusCode;
            this.logger.log(`${method} ${url} ${statusCode} ${duration}ms | user:${userId} | ip:${ip}`, {
                method,
                url,
                statusCode,
                duration,
                userId,
                ip,
                userAgent: userAgent.substring(0, 100),
            });
            if (duration > 2000) {
                this.logger.warn(`Respuesta lenta: ${method} ${url} tardó ${duration}ms`);
            }
        }), (0, operators_1.catchError)((error) => {
            const duration = Date.now() - startTime;
            this.logger.error(`${method} ${url} ERROR ${duration}ms | user:${userId} | ${error.message}`, {
                method,
                url,
                duration,
                userId,
                ip,
                error: error.message,
                stack: error.stack,
            });
            throw error;
        }));
    }
};
exports.LoggingInterceptor = LoggingInterceptor;
exports.LoggingInterceptor = LoggingInterceptor = __decorate([
    (0, common_1.Injectable)()
], LoggingInterceptor);
//# sourceMappingURL=logging.interceptor.js.map