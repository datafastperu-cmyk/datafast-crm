"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Router = exports.EstadoEquipo = exports.MetodoConexion = exports.VersionRouterOS = void 0;
const typeorm_1 = require("typeorm");
const base_entity_1 = require("../../../common/entities/base.entity");
var VersionRouterOS;
(function (VersionRouterOS) {
    VersionRouterOS["V6"] = "v6";
    VersionRouterOS["V7"] = "v7";
    VersionRouterOS["DESCONOCIDA"] = "desconocida";
})(VersionRouterOS || (exports.VersionRouterOS = VersionRouterOS = {}));
var MetodoConexion;
(function (MetodoConexion) {
    MetodoConexion["API"] = "api";
    MetodoConexion["API_SSL"] = "api_ssl";
    MetodoConexion["SSH"] = "ssh";
    MetodoConexion["SNMP"] = "snmp";
})(MetodoConexion || (exports.MetodoConexion = MetodoConexion = {}));
var EstadoEquipo;
(function (EstadoEquipo) {
    EstadoEquipo["ONLINE"] = "online";
    EstadoEquipo["OFFLINE"] = "offline";
    EstadoEquipo["DEGRADADO"] = "degradado";
    EstadoEquipo["MANTENIMIENTO"] = "mantenimiento";
    EstadoEquipo["DESCONOCIDO"] = "desconocido";
})(EstadoEquipo || (exports.EstadoEquipo = EstadoEquipo = {}));
let Router = class Router extends base_entity_1.BaseModel {
};
exports.Router = Router;
__decorate([
    (0, typeorm_1.Column)({ name: 'empresa_id' }),
    __metadata("design:type", String)
], Router.prototype, "empresaId", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 100 }),
    __metadata("design:type", String)
], Router.prototype, "nombre", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", String)
], Router.prototype, "descripcion", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 200, nullable: true }),
    __metadata("design:type", String)
], Router.prototype, "ubicacion", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 100, nullable: true }),
    __metadata("design:type", String)
], Router.prototype, "modelo", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'ip_gestion', type: 'inet' }),
    __metadata("design:type", String)
], Router.prototype, "ipGestion", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'puerto_api', type: 'smallint', default: 8728 }),
    __metadata("design:type", Number)
], Router.prototype, "puertoApi", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'puerto_api_ssl', type: 'smallint', default: 8729 }),
    __metadata("design:type", Number)
], Router.prototype, "puertoApiSsl", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'puerto_ssh', type: 'smallint', default: 22 }),
    __metadata("design:type", Number)
], Router.prototype, "puertoSsh", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 100 }),
    __metadata("design:type", String)
], Router.prototype, "usuario", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'password_cifrado', length: 500 }),
    __metadata("design:type", String)
], Router.prototype, "passwordCifrado", void 0);
__decorate([
    (0, typeorm_1.Column)({
        name: 'version_ros',
        type: 'enum',
        enum: VersionRouterOS,
        default: VersionRouterOS.DESCONOCIDA,
    }),
    __metadata("design:type", String)
], Router.prototype, "versionRos", void 0);
__decorate([
    (0, typeorm_1.Column)({
        name: 'metodo_conexion',
        type: 'enum',
        enum: MetodoConexion,
        default: MetodoConexion.API,
    }),
    __metadata("design:type", String)
], Router.prototype, "metodoConexion", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'usar_ssl', default: false }),
    __metadata("design:type", Boolean)
], Router.prototype, "usarSsl", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'timeout_conexion', type: 'smallint', default: 10 }),
    __metadata("design:type", Number)
], Router.prototype, "timeoutConexion", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: EstadoEquipo,
        default: EstadoEquipo.DESCONOCIDO,
    }),
    __metadata("design:type", String)
], Router.prototype, "estado", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'ultimo_ping', type: 'timestamptz', nullable: true }),
    __metadata("design:type", Date)
], Router.prototype, "ultimoPing", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'latencia_ms', type: 'decimal', precision: 8, scale: 2, nullable: true }),
    __metadata("design:type", Number)
], Router.prototype, "latenciaMs", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'uptime_segundos', type: 'bigint', nullable: true }),
    __metadata("design:type", Number)
], Router.prototype, "uptimeSegundos", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'version_firmware', length: 50, nullable: true }),
    __metadata("design:type", String)
], Router.prototype, "versionFirmware", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'identity_routeros', length: 100, nullable: true }),
    __metadata("design:type", String)
], Router.prototype, "identityRouteros", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'cpu_uso_pct', type: 'decimal', precision: 5, scale: 2, nullable: true }),
    __metadata("design:type", Number)
], Router.prototype, "cpuUsoPct", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'memoria_uso_pct', type: 'decimal', precision: 5, scale: 2, nullable: true }),
    __metadata("design:type", Number)
], Router.prototype, "memoriaUsoPct", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'temperatura_c', type: 'decimal', precision: 5, scale: 1, nullable: true }),
    __metadata("design:type", Number)
], Router.prototype, "temperaturaC", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 10, scale: 7, nullable: true }),
    __metadata("design:type", Number)
], Router.prototype, "latitud", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 10, scale: 7, nullable: true }),
    __metadata("design:type", Number)
], Router.prototype, "longitud", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'auto_configurar_queues', default: true }),
    __metadata("design:type", Boolean)
], Router.prototype, "autoConfigurarQueues", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'auto_configurar_pppoe', default: true }),
    __metadata("design:type", Boolean)
], Router.prototype, "autoConfigurarPppoe", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'auto_configurar_firewall', default: true }),
    __metadata("design:type", Boolean)
], Router.prototype, "autoConfigurarFirewall", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'snmp_community', length: 100, default: 'public' }),
    __metadata("design:type", String)
], Router.prototype, "snmpCommunity", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'snmp_version', type: 'smallint', default: 2 }),
    __metadata("design:type", Number)
], Router.prototype, "snmpVersion", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: true }),
    __metadata("design:type", Boolean)
], Router.prototype, "activo", void 0);
exports.Router = Router = __decorate([
    (0, typeorm_1.Entity)('routers'),
    (0, typeorm_1.Index)(['empresaId', 'activo']),
    (0, typeorm_1.Index)(['empresaId', 'estado']),
    (0, typeorm_1.Index)(['ipGestion'])
], Router);
//# sourceMappingURL=router.entity.js.map