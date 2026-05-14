"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SmartoltModule = void 0;
const event_emitter_1 = require("@nestjs/event-emitter");
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const axios_1 = require("@nestjs/axios");
const smartolt_controller_1 = require("./smartolt.controller");
const smartolt_service_1 = require("./smartolt.service");
const smartolt_api_service_1 = require("./smartolt-api.service");
const orquestador_ftth_service_1 = require("./orquestador-ftth.service");
const onu_repository_1 = require("./repositories/onu.repository");
const onu_entity_1 = require("./entities/onu.entity");
const auth_module_1 = require("../auth/auth.module");
const mikrotik_module_1 = require("../mikrotik/mikrotik.module");
let SmartoltModule = class SmartoltModule {
};
exports.SmartoltModule = SmartoltModule;
exports.SmartoltModule = SmartoltModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([onu_entity_1.Olt, onu_entity_1.Onu]),
            axios_1.HttpModule.register({
                timeout: 30_000,
                maxRedirects: 3,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'User-Agent': 'FibraNet-ISP/1.0',
                },
            }),
            event_emitter_1.EventEmitterModule.forRoot({
                wildcard: false,
                delimiter: '.',
                maxListeners: 20,
                ignoreErrors: false,
            }),
            auth_module_1.AuthModule,
            mikrotik_module_1.MikrotikModule,
        ],
        controllers: [smartolt_controller_1.SmartoltController],
        providers: [
            smartolt_service_1.SmartoltService,
            smartolt_api_service_1.SmartoltApiService,
            orquestador_ftth_service_1.OrquestadorFtthService,
            onu_repository_1.OnuRepository,
        ],
        exports: [
            smartolt_service_1.SmartoltService,
            smartolt_api_service_1.SmartoltApiService,
            orquestador_ftth_service_1.OrquestadorFtthService,
        ],
    })
], SmartoltModule);
//# sourceMappingURL=smartolt.module.js.map