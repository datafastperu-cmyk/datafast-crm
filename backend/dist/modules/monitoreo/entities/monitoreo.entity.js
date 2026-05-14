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
exports.ConfiguracionAlerta = exports.Alerta = exports.MedicionNodo = exports.Nodo = exports.MetricaAlerta = exports.EstadoAlerta = exports.NivelAlerta = exports.EstadoNodo = exports.TipoNodo = void 0;
const typeorm_1 = require("typeorm");
const base_entity_1 = require("../../../common/entities/base.entity");
var TipoNodo;
(function (TipoNodo) {
    TipoNodo["ROUTER"] = "router";
    TipoNodo["SWITCH"] = "switch";
    TipoNodo["OLT"] = "olt";
    TipoNodo["ANTENA"] = "antena";
    TipoNodo["SERVIDOR"] = "servidor";
    TipoNodo["CLIENTE"] = "cliente";
    TipoNodo["ENLACE_UPLINK"] = "enlace_uplink";
})(TipoNodo || (exports.TipoNodo = TipoNodo = {}));
var EstadoNodo;
(function (EstadoNodo) {
    EstadoNodo["ONLINE"] = "online";
    EstadoNodo["OFFLINE"] = "offline";
    EstadoNodo["DEGRADADO"] = "degradado";
    EstadoNodo["MANTENIMIENTO"] = "mantenimiento";
    EstadoNodo["DESCONOCIDO"] = "desconocido";
})(EstadoNodo || (exports.EstadoNodo = EstadoNodo = {}));
var NivelAlerta;
(function (NivelAlerta) {
    NivelAlerta["INFO"] = "info";
    NivelAlerta["WARNING"] = "warning";
    NivelAlerta["CRITICAL"] = "critical";
    NivelAlerta["RECOVERY"] = "recovery";
})(NivelAlerta || (exports.NivelAlerta = NivelAlerta = {}));
var EstadoAlerta;
(function (EstadoAlerta) {
    EstadoAlerta["ACTIVA"] = "activa";
    EstadoAlerta["RESUELTA"] = "resuelta";
    EstadoAlerta["IGNORADA"] = "ignorada";
})(EstadoAlerta || (exports.EstadoAlerta = EstadoAlerta = {}));
var MetricaAlerta;
(function (MetricaAlerta) {
    MetricaAlerta["PING_LATENCIA"] = "ping_latencia";
    MetricaAlerta["PING_PERDIDA"] = "ping_perdida";
    MetricaAlerta["CPU"] = "cpu";
    MetricaAlerta["MEMORIA"] = "memoria";
    MetricaAlerta["TRAFICO_BAJADA"] = "trafico_bajada";
    MetricaAlerta["TRAFICO_SUBIDA"] = "trafico_subida";
    MetricaAlerta["TEMPERATURA"] = "temperatura";
    MetricaAlerta["ESTADO_NODO"] = "estado_nodo";
    MetricaAlerta["SESIONES_PPPOE"] = "sesiones_pppoe";
    MetricaAlerta["SENAL_ONU"] = "senal_onu";
})(MetricaAlerta || (exports.MetricaAlerta = MetricaAlerta = {}));
let Nodo = class Nodo extends base_entity_1.BaseModel {
};
exports.Nodo = Nodo;
__decorate([
    (0, typeorm_1.Column)({ name: 'empresa_id' }),
    __metadata("design:type", String)
], Nodo.prototype, "empresaId", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 100 }),
    __metadata("design:type", String)
], Nodo.prototype, "nombre", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", String)
], Nodo.prototype, "descripcion", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: TipoNodo, default: TipoNodo.ROUTER }),
    __metadata("design:type", String)
], Nodo.prototype, "tipo", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'router_id', nullable: true }),
    __metadata("design:type", String)
], Nodo.prototype, "routerId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'olt_id', nullable: true }),
    __metadata("design:type", String)
], Nodo.prototype, "oltId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'ip_monitoreo', type: 'inet' }),
    __metadata("design:type", String)
], Nodo.prototype, "ipMonitoreo", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'snmp_habilitado', default: false }),
    __metadata("design:type", Boolean)
], Nodo.prototype, "snmpHabilitado", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'snmp_community', length: 100, default: 'public' }),
    __metadata("design:type", String)
], Nodo.prototype, "snmpCommunity", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'snmp_version', type: 'smallint', default: 2 }),
    __metadata("design:type", Number)
], Nodo.prototype, "snmpVersion", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'snmp_puerto', type: 'smallint', default: 161 }),
    __metadata("design:type", Number)
], Nodo.prototype, "snmpPuerto", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'snmp_oid_trafico_rx', length: 200, nullable: true }),
    __metadata("design:type", String)
], Nodo.prototype, "snmpOidTraficoRx", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'snmp_oid_trafico_tx', length: 200, nullable: true }),
    __metadata("design:type", String)
], Nodo.prototype, "snmpOidTraficoTx", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'snmp_oid_cpu', length: 200, nullable: true }),
    __metadata("design:type", String)
], Nodo.prototype, "snmpOidCpu", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'snmp_interface_index', type: 'int', nullable: true }),
    __metadata("design:type", Number)
], Nodo.prototype, "snmpInterfaceIndex", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'ping_habilitado', default: true }),
    __metadata("design:type", Boolean)
], Nodo.prototype, "pingHabilitado", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'ping_intervalo_seg', type: 'smallint', default: 60 }),
    __metadata("design:type", Number)
], Nodo.prototype, "pingIntervaloSeg", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'ping_timeout_ms', type: 'int', default: 3000 }),
    __metadata("design:type", Number)
], Nodo.prototype, "pingTimeoutMs", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'ping_reintentos', type: 'smallint', default: 3 }),
    __metadata("design:type", Number)
], Nodo.prototype, "pingReintentos", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: EstadoNodo, default: EstadoNodo.DESCONOCIDO }),
    __metadata("design:type", String)
], Nodo.prototype, "estado", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'ultimo_ping', type: 'timestamptz', nullable: true }),
    __metadata("design:type", Date)
], Nodo.prototype, "ultimoPing", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'latencia_ms', type: 'decimal', precision: 8, scale: 2, nullable: true }),
    __metadata("design:type", Number)
], Nodo.prototype, "latenciaMs", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'perdida_pct', type: 'decimal', precision: 5, scale: 2, nullable: true }),
    __metadata("design:type", Number)
], Nodo.prototype, "perdidaPct", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'estado_desde', type: 'timestamptz', default: () => 'NOW()' }),
    __metadata("design:type", Date)
], Nodo.prototype, "estadoDesde", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'uptime_pct_7d', type: 'decimal', precision: 5, scale: 2, nullable: true }),
    __metadata("design:type", Number)
], Nodo.prototype, "uptimePct7d", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'cpu_uso_pct', type: 'decimal', precision: 5, scale: 2, nullable: true }),
    __metadata("design:type", Number)
], Nodo.prototype, "cpuUsoPct", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'memoria_uso_pct', type: 'decimal', precision: 5, scale: 2, nullable: true }),
    __metadata("design:type", Number)
], Nodo.prototype, "memoriaUsoPct", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'trafico_rx_bps', type: 'bigint', nullable: true }),
    __metadata("design:type", Number)
], Nodo.prototype, "traficoRxBps", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'trafico_tx_bps', type: 'bigint', nullable: true }),
    __metadata("design:type", Number)
], Nodo.prototype, "traficoTxBps", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'temperatura_c', type: 'decimal', precision: 5, scale: 1, nullable: true }),
    __metadata("design:type", Number)
], Nodo.prototype, "temperaturaC", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'sesiones_pppoe', type: 'int', nullable: true }),
    __metadata("design:type", Number)
], Nodo.prototype, "sesionesPppoe", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: true }),
    __metadata("design:type", Boolean)
], Nodo.prototype, "activo", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'alertas_habilitadas', default: true }),
    __metadata("design:type", Boolean)
], Nodo.prototype, "alertasHabilitadas", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 10, scale: 7, nullable: true }),
    __metadata("design:type", Number)
], Nodo.prototype, "latitud", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 10, scale: 7, nullable: true }),
    __metadata("design:type", Number)
], Nodo.prototype, "longitud", void 0);
exports.Nodo = Nodo = __decorate([
    (0, typeorm_1.Entity)('nodos'),
    (0, typeorm_1.Index)(['empresaId', 'activo']),
    (0, typeorm_1.Index)(['empresaId', 'estado']),
    (0, typeorm_1.Index)(['ipMonitoreo'])
], Nodo);
let MedicionNodo = class MedicionNodo {
};
exports.MedicionNodo = MedicionNodo;
__decorate([
    (0, typeorm_1.Column)({ primary: true, generated: 'uuid' }),
    __metadata("design:type", String)
], MedicionNodo.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'nodo_id' }),
    __metadata("design:type", String)
], MedicionNodo.prototype, "nodoId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'empresa_id' }),
    __metadata("design:type", String)
], MedicionNodo.prototype, "empresaId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'timestamp', type: 'timestamptz', default: () => 'NOW()' }),
    __metadata("design:type", Date)
], MedicionNodo.prototype, "timestamp", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'latencia_ms', type: 'decimal', precision: 8, scale: 2, nullable: true }),
    __metadata("design:type", Number)
], MedicionNodo.prototype, "latenciaMs", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'perdida_pct', type: 'decimal', precision: 5, scale: 2, nullable: true }),
    __metadata("design:type", Number)
], MedicionNodo.prototype, "perdidaPct", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'online', default: true }),
    __metadata("design:type", Boolean)
], MedicionNodo.prototype, "online", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'cpu_pct', type: 'decimal', precision: 5, scale: 2, nullable: true }),
    __metadata("design:type", Number)
], MedicionNodo.prototype, "cpuPct", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'memoria_pct', type: 'decimal', precision: 5, scale: 2, nullable: true }),
    __metadata("design:type", Number)
], MedicionNodo.prototype, "memoriaPct", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'trafico_rx_bps', type: 'bigint', nullable: true }),
    __metadata("design:type", Number)
], MedicionNodo.prototype, "traficoRxBps", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'trafico_tx_bps', type: 'bigint', nullable: true }),
    __metadata("design:type", Number)
], MedicionNodo.prototype, "traficoTxBps", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'temperatura_c', type: 'decimal', precision: 5, scale: 1, nullable: true }),
    __metadata("design:type", Number)
], MedicionNodo.prototype, "temperaturaC", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'sesiones_pppoe', type: 'int', nullable: true }),
    __metadata("design:type", Number)
], MedicionNodo.prototype, "sesionesPppoe", void 0);
exports.MedicionNodo = MedicionNodo = __decorate([
    (0, typeorm_1.Entity)('nodos_mediciones'),
    (0, typeorm_1.Index)(['nodoId', 'timestamp']),
    (0, typeorm_1.Index)(['empresaId', 'timestamp'])
], MedicionNodo);
let Alerta = class Alerta extends base_entity_1.BaseModel {
};
exports.Alerta = Alerta;
__decorate([
    (0, typeorm_1.Column)({ name: 'empresa_id' }),
    __metadata("design:type", String)
], Alerta.prototype, "empresaId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'nodo_id', nullable: true }),
    __metadata("design:type", String)
], Alerta.prototype, "nodoId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'nodo_nombre', length: 100, nullable: true }),
    __metadata("design:type", String)
], Alerta.prototype, "nodoNombre", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: NivelAlerta }),
    __metadata("design:type", String)
], Alerta.prototype, "nivel", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: EstadoAlerta, default: EstadoAlerta.ACTIVA }),
    __metadata("design:type", String)
], Alerta.prototype, "estado", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: MetricaAlerta }),
    __metadata("design:type", String)
], Alerta.prototype, "metrica", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text' }),
    __metadata("design:type", String)
], Alerta.prototype, "mensaje", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", String)
], Alerta.prototype, "detalle", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'valor_actual', type: 'decimal', precision: 12, scale: 4, nullable: true }),
    __metadata("design:type", Number)
], Alerta.prototype, "valorActual", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'umbral', type: 'decimal', precision: 12, scale: 4, nullable: true }),
    __metadata("design:type", Number)
], Alerta.prototype, "umbral", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'resuelta_en', type: 'timestamptz', nullable: true }),
    __metadata("design:type", Date)
], Alerta.prototype, "resueltaEn", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'resuelta_por', nullable: true }),
    __metadata("design:type", String)
], Alerta.prototype, "resueltaPor", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'duracion_minutos', type: 'int', nullable: true }),
    __metadata("design:type", Number)
], Alerta.prototype, "duracionMinutos", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'notificado_email', default: false }),
    __metadata("design:type", Boolean)
], Alerta.prototype, "notificadoEmail", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'notificado_whatsapp', default: false }),
    __metadata("design:type", Boolean)
], Alerta.prototype, "notificadoWhatsapp", void 0);
exports.Alerta = Alerta = __decorate([
    (0, typeorm_1.Entity)('alertas'),
    (0, typeorm_1.Index)(['empresaId', 'estado', 'nivel']),
    (0, typeorm_1.Index)(['nodoId', 'createdAt']),
    (0, typeorm_1.Index)(['empresaId', 'createdAt'])
], Alerta);
let ConfiguracionAlerta = class ConfiguracionAlerta extends base_entity_1.BaseModel {
};
exports.ConfiguracionAlerta = ConfiguracionAlerta;
__decorate([
    (0, typeorm_1.Column)({ name: 'empresa_id' }),
    __metadata("design:type", String)
], ConfiguracionAlerta.prototype, "empresaId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'nodo_id', nullable: true }),
    __metadata("design:type", String)
], ConfiguracionAlerta.prototype, "nodoId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: MetricaAlerta }),
    __metadata("design:type", String)
], ConfiguracionAlerta.prototype, "metrica", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'umbral_warning', type: 'decimal', precision: 10, scale: 2 }),
    __metadata("design:type", Number)
], ConfiguracionAlerta.prototype, "umbralWarning", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'umbral_critical', type: 'decimal', precision: 10, scale: 2 }),
    __metadata("design:type", Number)
], ConfiguracionAlerta.prototype, "umbralCritical", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'duracion_minutos', type: 'smallint', default: 1 }),
    __metadata("design:type", Number)
], ConfiguracionAlerta.prototype, "duracionMinutos", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'notificar_email', default: false }),
    __metadata("design:type", Boolean)
], ConfiguracionAlerta.prototype, "notificarEmail", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'notificar_whatsapp', default: false }),
    __metadata("design:type", Boolean)
], ConfiguracionAlerta.prototype, "notificarWhatsapp", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'email_destino', length: 200, nullable: true }),
    __metadata("design:type", String)
], ConfiguracionAlerta.prototype, "emailDestino", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'telefono_destino', length: 20, nullable: true }),
    __metadata("design:type", String)
], ConfiguracionAlerta.prototype, "telefonoDestino", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: true }),
    __metadata("design:type", Boolean)
], ConfiguracionAlerta.prototype, "activo", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", String)
], ConfiguracionAlerta.prototype, "descripcion", void 0);
exports.ConfiguracionAlerta = ConfiguracionAlerta = __decorate([
    (0, typeorm_1.Entity)('configuracion_alertas'),
    (0, typeorm_1.Index)(['empresaId', 'activo'])
], ConfiguracionAlerta);
//# sourceMappingURL=monitoreo.entity.js.map