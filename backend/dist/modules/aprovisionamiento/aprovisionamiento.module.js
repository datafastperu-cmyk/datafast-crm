"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AprovisionamientoModule = void 0;
const event_emitter_1 = require("@nestjs/event-emitter");
const common_1 = require("@nestjs/common");
const axios_1 = require("@nestjs/axios");
const aprovisionamiento_controller_1 = require("./aprovisionamiento.controller");
const aprovisionamiento_service_1 = require("./aprovisionamiento.service");
const whatsapp_service_1 = require("../notificaciones/services/whatsapp.service");
const auth_module_1 = require("../auth/auth.module");
const mikrotik_module_1 = require("../mikrotik/mikrotik.module");
const smartolt_module_1 = require("../smartolt/smartolt.module");
let AprovisionamientoModule = class AprovisionamientoModule {
};
exports.AprovisionamientoModule = AprovisionamientoModule;
exports.AprovisionamientoModule = AprovisionamientoModule = __decorate([
    (0, common_1.Module)({
        imports: [
            axios_1.HttpModule.register({ timeout: 15_000 }),
            event_emitter_1.EventEmitterModule.forRoot({ wildcard: false, delimiter: '.', maxListeners: 20 }),
            auth_module_1.AuthModule,
            mikrotik_module_1.MikrotikModule,
            smartolt_module_1.SmartoltModule,
        ],
        controllers: [aprovisionamiento_controller_1.AprovisionamientoController],
        providers: [
            aprovisionamiento_service_1.OrquestadorAprovisionamientoService,
            whatsapp_service_1.WhatsAppService,
        ],
        exports: [
            aprovisionamiento_service_1.OrquestadorAprovisionamientoService,
            whatsapp_service_1.WhatsAppService,
        ],
    })
], AprovisionamientoModule);
//# sourceMappingURL=aprovisionamiento.module.js.map