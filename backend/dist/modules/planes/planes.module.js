"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlanesModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const planes_controller_1 = require("./planes.controller");
const planes_service_1 = require("./planes.service");
const plan_entity_1 = require("./entities/plan.entity");
let PlanesModule = class PlanesModule {
};
exports.PlanesModule = PlanesModule;
exports.PlanesModule = PlanesModule = __decorate([
    (0, common_1.Module)({
        imports: [typeorm_1.TypeOrmModule.forFeature([plan_entity_1.Plan])],
        controllers: [planes_controller_1.PlanesController],
        providers: [planes_service_1.PlanesService],
        exports: [planes_service_1.PlanesService],
    })
], PlanesModule);
//# sourceMappingURL=planes.module.js.map