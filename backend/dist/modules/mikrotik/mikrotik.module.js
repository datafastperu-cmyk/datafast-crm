"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MikrotikModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const bull_1 = require("@nestjs/bull");
const schedule_1 = require("@nestjs/schedule");
const event_emitter_1 = require("@nestjs/event-emitter");
const mikrotik_controller_1 = require("./mikrotik.controller");
const mikrotik_service_1 = require("./mikrotik.service");
const connection_pool_service_1 = require("./services/connection-pool.service");
const pppoe_service_1 = require("./services/pppoe.service");
const queue_service_1 = require("./services/queue.service");
const firewall_service_1 = require("./services/firewall.service");
const interface_service_1 = require("./services/interface.service");
const velocidad_service_1 = require("./services/velocidad/velocidad.service");
const mangle_service_1 = require("./services/velocidad/mangle.service");
const queue_tree_cliente_service_1 = require("./services/velocidad/queue-tree-cliente.service");
const velocidad_orquestador_service_1 = require("./services/velocidad/velocidad-orquestador.service");
const velocidad_controller_1 = require("./velocidad.controller");
const velocidad_worker_1 = require("./velocidad.worker");
const router_entity_1 = require("./entities/router.entity");
const auth_module_1 = require("../auth/auth.module");
let MikrotikModule = class MikrotikModule {
};
exports.MikrotikModule = MikrotikModule;
exports.MikrotikModule = MikrotikModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([router_entity_1.Router]),
            bull_1.BullModule.registerQueue({
                name: velocidad_worker_1.VELOCIDAD_QUEUE,
                defaultJobOptions: {
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 10_000 },
                    removeOnComplete: 50,
                    removeOnFail: 200,
                },
            }),
            schedule_1.ScheduleModule,
            event_emitter_1.EventEmitterModule.forRoot({
                wildcard: false,
                delimiter: '.',
                newListener: false,
                removeListener: false,
                maxListeners: 20,
                verboseMemoryLeak: true,
                ignoreErrors: false,
            }),
            auth_module_1.AuthModule,
        ],
        controllers: [
            mikrotik_controller_1.MikrotikController,
            velocidad_controller_1.VelocidadController,
        ],
        providers: [
            mikrotik_service_1.MikrotikService,
            connection_pool_service_1.RouterConnectionPool,
            pppoe_service_1.PppoeService,
            queue_service_1.QueueService,
            firewall_service_1.FirewallService,
            interface_service_1.InterfaceService,
            velocidad_service_1.VelocidadService,
            mangle_service_1.MangleService,
            queue_tree_cliente_service_1.QueueTreeClienteService,
            velocidad_orquestador_service_1.VelocidadOrquestador,
            velocidad_worker_1.VelocidadWorker,
            velocidad_worker_1.VelocidadScheduler,
        ],
        exports: [
            mikrotik_service_1.MikrotikService,
            connection_pool_service_1.RouterConnectionPool,
            pppoe_service_1.PppoeService,
            queue_service_1.QueueService,
            firewall_service_1.FirewallService,
            interface_service_1.InterfaceService,
            velocidad_orquestador_service_1.VelocidadOrquestador,
            velocidad_worker_1.VelocidadScheduler,
        ],
    })
], MikrotikModule);
//# sourceMappingURL=mikrotik.module.js.map