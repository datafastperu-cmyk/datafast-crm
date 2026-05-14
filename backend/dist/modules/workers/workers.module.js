"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkersModule = void 0;
const event_emitter_1 = require("@nestjs/event-emitter");
const common_1 = require("@nestjs/common");
const bull_1 = require("@nestjs/bull");
const schedule_1 = require("@nestjs/schedule");
const axios_1 = require("@nestjs/axios");
const cobranza_worker_1 = require("./cobranza.worker");
const facturacion_worker_1 = require("./facturacion.worker");
const auth_module_1 = require("../auth/auth.module");
const mikrotik_module_1 = require("../mikrotik/mikrotik.module");
const facturacion_module_1 = require("../facturacion/facturacion.module");
const whatsapp_service_1 = require("../notificaciones/services/whatsapp.service");
const workers_constants_1 = require("./workers.constants");
let WorkersModule = class WorkersModule {
};
exports.WorkersModule = WorkersModule;
exports.WorkersModule = WorkersModule = __decorate([
    (0, common_1.Module)({
        imports: [
            bull_1.BullModule.registerQueue({
                name: workers_constants_1.QUEUES.COBRANZA,
                defaultJobOptions: {
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 30_000 },
                    removeOnComplete: 500,
                    removeOnFail: 1000,
                },
            }, {
                name: workers_constants_1.QUEUES.FACTURACION,
                defaultJobOptions: {
                    attempts: 1,
                    removeOnComplete: 200,
                    removeOnFail: 500,
                },
            }, {
                name: workers_constants_1.QUEUES.NOTIFICACIONES,
                defaultJobOptions: {
                    attempts: 2,
                    backoff: { type: 'fixed', delay: 60_000 },
                    removeOnComplete: 200,
                    removeOnFail: 200,
                },
            }),
            schedule_1.ScheduleModule,
            event_emitter_1.EventEmitterModule.forRoot({
                wildcard: false,
                delimiter: '.',
                maxListeners: 30,
                ignoreErrors: false,
            }),
            axios_1.HttpModule.register({ timeout: 15_000 }),
            auth_module_1.AuthModule,
            mikrotik_module_1.MikrotikModule,
            facturacion_module_1.FacturacionModule,
        ],
        providers: [
            whatsapp_service_1.WhatsAppService,
            cobranza_worker_1.CobranzaScheduler,
            cobranza_worker_1.CobranzaWorker,
            facturacion_worker_1.FacturacionScheduler,
            facturacion_worker_1.FacturacionWorker,
        ],
        exports: [
            cobranza_worker_1.CobranzaScheduler,
            facturacion_worker_1.FacturacionScheduler,
        ],
    })
], WorkersModule);
//# sourceMappingURL=workers.module.js.map