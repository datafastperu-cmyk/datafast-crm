"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FacturacionModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const bull_1 = require("@nestjs/bull");
const schedule_1 = require("@nestjs/schedule");
const facturacion_controller_1 = require("./facturacion.controller");
const facturacion_service_1 = require("./facturacion.service");
const factura_repository_1 = require("./repositories/factura.repository");
const pdf_service_1 = require("./pdf.service");
const facturacion_worker_1 = require("./facturacion.worker");
const factura_entity_1 = require("./entities/factura.entity");
const auth_module_1 = require("../auth/auth.module");
let FacturacionModule = class FacturacionModule {
};
exports.FacturacionModule = FacturacionModule;
exports.FacturacionModule = FacturacionModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([factura_entity_1.Factura]),
            bull_1.BullModule.registerQueue({
                name: facturacion_worker_1.FACTURACION_QUEUE,
                defaultJobOptions: {
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 10_000 },
                    removeOnComplete: 100,
                    removeOnFail: 500,
                },
            }),
            schedule_1.ScheduleModule,
            auth_module_1.AuthModule,
        ],
        controllers: [facturacion_controller_1.FacturacionController],
        providers: [
            facturacion_service_1.FacturacionService,
            factura_repository_1.FacturaRepository,
            pdf_service_1.PdfService,
            facturacion_worker_1.FacturacionWorker,
            facturacion_worker_1.FacturacionScheduler,
        ],
        exports: [
            facturacion_service_1.FacturacionService,
            factura_repository_1.FacturaRepository,
        ],
    })
], FacturacionModule);
//# sourceMappingURL=facturacion.module.js.map