"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransformInterceptor = void 0;
const common_1 = require("@nestjs/common");
const operators_1 = require("rxjs/operators");
const response_dto_1 = require("../dto/response.dto");
let TransformInterceptor = class TransformInterceptor {
    intercept(context, next) {
        if (context.getType() !== 'http') {
            return next.handle();
        }
        return next.handle().pipe((0, operators_1.map)((data) => {
            if (data instanceof response_dto_1.ApiResponse) {
                return data;
            }
            if (data === null || data === undefined) {
                return response_dto_1.ApiResponse.ok(null, 'Sin datos');
            }
            return response_dto_1.ApiResponse.ok(data);
        }));
    }
};
exports.TransformInterceptor = TransformInterceptor;
exports.TransformInterceptor = TransformInterceptor = __decorate([
    (0, common_1.Injectable)()
], TransformInterceptor);
//# sourceMappingURL=transform.interceptor.js.map