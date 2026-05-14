"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContratosModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const contratos_controller_1 = require("./contratos.controller");
const contratos_service_1 = require("./contratos.service");
const contrato_repository_1 = require("./repositories/contrato.repository");
const contrato_entity_1 = require("./entities/contrato.entity");
const red_entity_1 = require("./entities/red.entity");
const planes_module_1 = require("../planes/planes.module");
const auth_module_1 = require("../auth/auth.module");
let ContratosModule = class ContratosModule {
};
exports.ContratosModule = ContratosModule;
exports.ContratosModule = ContratosModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([contrato_entity_1.Contrato, contrato_entity_1.ContratoHistorial, red_entity_1.SegmentoIpv4, red_entity_1.IpAsignada]),
            planes_module_1.PlanesModule,
            auth_module_1.AuthModule,
        ],
        controllers: [contratos_controller_1.ContratosController],
        providers: [contratos_service_1.ContratosService, contrato_repository_1.ContratoRepository],
        exports: [contratos_service_1.ContratosService, contrato_repository_1.ContratoRepository],
    })
], ContratosModule);
//# sourceMappingURL=contratos.module.js.map