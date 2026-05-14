"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PagosModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const axios_1 = require("@nestjs/axios");
const platform_express_1 = require("@nestjs/platform-express");
const multer_1 = require("multer");
const pagos_controller_1 = require("./pagos.controller");
const pagos_service_1 = require("./pagos.service");
const pago_repository_1 = require("./repositories/pago.repository");
const mercadopago_service_1 = require("./mercadopago.service");
const pago_entity_1 = require("./entities/pago.entity");
const facturacion_module_1 = require("../facturacion/facturacion.module");
const contratos_module_1 = require("../contratos/contratos.module");
const auth_module_1 = require("../auth/auth.module");
let PagosModule = class PagosModule {
};
exports.PagosModule = PagosModule;
exports.PagosModule = PagosModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([pago_entity_1.Pago, pago_entity_1.CuentaBancaria]),
            axios_1.HttpModule.register({
                timeout: 15_000,
                maxRedirects: 3,
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'FibraNet-ISP/1.0',
                },
            }),
            platform_express_1.MulterModule.register({ storage: (0, multer_1.memoryStorage)() }),
            facturacion_module_1.FacturacionModule,
            contratos_module_1.ContratosModule,
            auth_module_1.AuthModule,
        ],
        controllers: [pagos_controller_1.PagosController],
        providers: [
            pagos_service_1.PagosService,
            pago_repository_1.PagoRepository,
            mercadopago_service_1.MercadoPagoService,
        ],
        exports: [
            pagos_service_1.PagosService,
            pago_repository_1.PagoRepository,
        ],
    })
], PagosModule);
//# sourceMappingURL=pagos.module.js.map