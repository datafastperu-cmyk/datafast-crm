"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthModule = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const passport_1 = require("@nestjs/passport");
const typeorm_1 = require("@nestjs/typeorm");
const config_1 = require("@nestjs/config");
const auth_controller_1 = require("./auth.controller");
const auth_service_1 = require("./auth.service");
const auditoria_service_1 = require("./auditoria.service");
const jwt_strategy_1 = require("./strategies/jwt.strategy");
const jwt_refresh_strategy_1 = require("./strategies/jwt-refresh.strategy");
const usuario_entity_1 = require("../usuarios/entities/usuario.entity");
const rol_entity_1 = require("../usuarios/entities/rol.entity");
const permiso_entity_1 = require("../usuarios/entities/permiso.entity");
const auditoria_log_entity_1 = require("../usuarios/entities/auditoria-log.entity");
let AuthModule = class AuthModule {
};
exports.AuthModule = AuthModule;
exports.AuthModule = AuthModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([usuario_entity_1.Usuario, rol_entity_1.Rol, permiso_entity_1.Permiso, auditoria_log_entity_1.AuditoriaLog]),
            passport_1.PassportModule.register({ defaultStrategy: 'jwt' }),
            jwt_1.JwtModule.registerAsync({
                imports: [config_1.ConfigModule],
                useFactory: (config) => ({
                    secret: config.get('jwt.secret'),
                    signOptions: {
                        expiresIn: config.get('jwt.expiresIn', '15m'),
                        issuer: 'fibranet-isp',
                        audience: 'fibranet-app',
                    },
                }),
                inject: [config_1.ConfigService],
            }),
        ],
        controllers: [auth_controller_1.AuthController],
        providers: [
            auth_service_1.AuthService,
            auditoria_service_1.AuditoriaService,
            jwt_strategy_1.JwtStrategy,
            jwt_refresh_strategy_1.JwtRefreshStrategy,
        ],
        exports: [
            auth_service_1.AuthService,
            auditoria_service_1.AuditoriaService,
            jwt_1.JwtModule,
            passport_1.PassportModule,
        ],
    })
], AuthModule);
//# sourceMappingURL=auth.module.js.map