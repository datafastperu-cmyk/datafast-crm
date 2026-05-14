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
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimeoutInterceptor = void 0;
const common_1 = require("@nestjs/common");
const rxjs_1 = require("rxjs");
const operators_1 = require("rxjs/operators");
let TimeoutInterceptor = class TimeoutInterceptor {
    constructor(timeoutMs = 30000) {
        this.timeoutMs = timeoutMs;
    }
    intercept(context, next) {
        const req = context.switchToHttp().getRequest();
        const longRunningPaths = ['/provisioning', '/reportes', '/export'];
        const isLongRunning = longRunningPaths.some((p) => req?.url?.includes(p));
        const timeoutDuration = isLongRunning ? 120000 : this.timeoutMs;
        return next.handle().pipe((0, operators_1.timeout)(timeoutDuration), (0, operators_1.catchError)((error) => {
            if (error instanceof rxjs_1.TimeoutError) {
                return (0, rxjs_1.throwError)(() => new common_1.RequestTimeoutException(`La solicitud tardó más de ${timeoutDuration / 1000}s en procesarse`));
            }
            return (0, rxjs_1.throwError)(() => error);
        }));
    }
};
exports.TimeoutInterceptor = TimeoutInterceptor;
exports.TimeoutInterceptor = TimeoutInterceptor = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [Number])
], TimeoutInterceptor);
//# sourceMappingURL=timeout.interceptor.js.map