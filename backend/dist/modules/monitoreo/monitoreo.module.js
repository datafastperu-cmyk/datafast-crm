"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MonitoreoModule = void 0;
const event_emitter_1 = require("@nestjs/event-emitter");
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const bull_1 = require("@nestjs/bull");
const schedule_1 = require("@nestjs/schedule");
const monitoreo_controller_1 = require("./monitoreo.controller");
const monitoreo_gateway_1 = require("./gateways/monitoreo.gateway");
const monitoreo_worker_1 = require("./monitoreo.worker");
const ping_service_1 = require("./services/ping.service");
const snmp_service_1 = require("./services/snmp.service");
const alertas_service_1 = require("./services/alertas.service");
const monitoreo_entity_1 = require("./entities/monitoreo.entity");
const auth_module_1 = require("../auth/auth.module");
const whatsapp_service_1 = require("../notificaciones/services/whatsapp.service");
const axios_1 = require("@nestjs/axios");
let MonitoreoModule = class MonitoreoModule {
};
exports.MonitoreoModule = MonitoreoModule;
exports.MonitoreoModule = MonitoreoModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([monitoreo_entity_1.Nodo, monitoreo_entity_1.MedicionNodo, monitoreo_entity_1.Alerta, monitoreo_entity_1.ConfiguracionAlerta]),
            bull_1.BullModule.registerQueue({
                name: monitoreo_worker_1.MONITOREO_QUEUE,
                defaultJobOptions: {
                    attempts: 1,
                    removeOnComplete: 200,
                    removeOnFail: 100,
                },
            }),
            schedule_1.ScheduleModule,
            event_emitter_1.EventEmitterModule.forRoot({
                wildcard: false,
                delimiter: '.',
                newListener: false,
                removeListener: false,
                maxListeners: 30,
                verboseMemoryLeak: false,
                ignoreErrors: false,
            }),
            axios_1.HttpModule.register({ timeout: 10_000 }),
            auth_module_1.AuthModule,
        ],
        controllers: [monitoreo_controller_1.MonitoreoController],
        providers: [
            ping_service_1.PingService,
            snmp_service_1.SnmpService,
            alertas_service_1.AlertasService,
            whatsapp_service_1.WhatsAppService,
            monitoreo_gateway_1.MonitoreoGateway,
            monitoreo_worker_1.MonitoreoWorker,
            monitoreo_worker_1.MonitoreoScheduler,
        ],
        exports: [
            monitoreo_gateway_1.MonitoreoGateway,
            alertas_service_1.AlertasService,
            ping_service_1.PingService,
            snmp_service_1.SnmpService,
        ],
    })
], MonitoreoModule);
//# sourceMappingURL=monitoreo.module.js.map