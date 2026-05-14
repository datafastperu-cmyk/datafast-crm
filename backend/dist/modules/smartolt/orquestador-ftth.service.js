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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var OrquestadorFtthService_1;
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrquestadorFtthService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const event_emitter_1 = require("@nestjs/event-emitter");
const smartolt_service_1 = require("./smartolt.service");
const smartolt_api_service_1 = require("./smartolt-api.service");
const mikrotik_service_1 = require("../mikrotik/mikrotik.service");
const pppoe_service_1 = require("../mikrotik/services/pppoe.service");
const velocidad_orquestador_service_1 = require("../mikrotik/services/velocidad/velocidad-orquestador.service");
const firewall_service_1 = require("../mikrotik/services/firewall.service");
const auditoria_service_1 = require("../auth/auditoria.service");
const encryption_util_1 = require("../../common/utils/encryption.util");
let OrquestadorFtthService = OrquestadorFtthService_1 = class OrquestadorFtthService {
    constructor(smartoltSvc, smartoltApi, mikrotikSvc, pppoeSvc, velocidadOrc, firewallSvc, auditoria, events, ds) {
        this.smartoltSvc = smartoltSvc;
        this.smartoltApi = smartoltApi;
        this.mikrotikSvc = mikrotikSvc;
        this.pppoeSvc = pppoeSvc;
        this.velocidadOrc = velocidadOrc;
        this.firewallSvc = firewallSvc;
        this.auditoria = auditoria;
        this.events = events;
        this.ds = ds;
        this.logger = new common_1.Logger(OrquestadorFtthService_1.name);
    }
    async ejecutarFlujoComipletoFtth(dto, user) {
        const resultado = {
            pasos: [],
            exitoso: false,
            mensajeFinal: '',
        };
        const ctx = {};
        const pasos = [
            {
                paso: 1,
                nombre: 'Validar contrato, cliente y plan',
                fn: async () => {
                    const [row] = await this.ds.query(`
            SELECT
              co.id, co.numero_contrato, co.estado,
              co.usuario_pppoe, co.password_pppoe, co.ip_asignada,
              co.aprovisionado,
              cl.nombre_completo AS cliente_nombre, cl.telefono, cl.email,
              pl.nombre AS plan_nombre, pl.velocidad_bajada, pl.velocidad_subida,
              pl.tipo_queue, pl.ppp_profile, pl.tipo AS tipo_plan,
              pl.burst_bajada, pl.burst_subida, pl.burst_tiempo,
              ro.id AS router_id, ro.ip_gestion AS router_ip,
              ro.version_ros, ro.usuario AS router_user,
              ro.password_cifrado AS router_pass, ro.usar_ssl,
              ro.puerto_api, ro.puerto_api_ssl, ro.timeout_conexion
            FROM contratos co
            JOIN clientes cl ON cl.id = co.cliente_id
            JOIN planes   pl ON pl.id = co.plan_id
            JOIN routers  ro ON ro.id = $2
            WHERE co.id = $1 AND co.empresa_id = $3 AND co.deleted_at IS NULL
          `, [dto.contratoId, dto.routerId, user.empresaId]);
                    if (!row)
                        throw new Error('Contrato o router no encontrado');
                    if (row.aprovisionado) {
                        throw new Error(`El contrato ${row.numero_contrato} ya está aprovisionado`);
                    }
                    if (!['pendiente_instalacion', 'activo'].includes(row.estado)) {
                        throw new Error(`Estado del contrato no permite aprovisionamiento: ${row.estado}`);
                    }
                    ctx.contrato = row;
                    ctx.usuarioPppoe = row.usuario_pppoe;
                    ctx.passwordPppoe = row.password_pppoe;
                    ctx.ipAsignada = row.ip_asignada;
                    return `Contrato ${row.numero_contrato} | Cliente: ${row.cliente_nombre} | Plan: ${row.plan_nombre}`;
                },
            },
            {
                paso: 2,
                nombre: 'Verificar/asignar IP del pool',
                fn: async () => {
                    if (ctx.ipAsignada) {
                        return `IP ya asignada: ${ctx.ipAsignada}`;
                    }
                    if (!dto.segmentoId) {
                        return 'Sin segmento configurado — IP se asignará manualmente';
                    }
                    const [segmento] = await this.ds.query('SELECT red_cidr, gateway, ips_reservadas FROM segmentos_ipv4 WHERE id = $1 AND empresa_id = $2', [dto.segmentoId, user.empresaId]);
                    if (!segmento)
                        throw new Error('Segmento IPv4 no encontrado');
                    const [{ fn_next_available_ip: ip }] = await this.ds.query('SELECT fn_next_available_ip($1, $2)', [dto.segmentoId, segmento.ips_reservadas || '{}']).catch(() => [{ fn_next_available_ip: null }]);
                    if (!ip)
                        throw new Error('Pool IPv4 exhausto — sin IPs disponibles');
                    await this.ds.query(`
            INSERT INTO ips_asignadas (empresa_id, segmento_id, contrato_id, ip_address, tipo, activa)
            VALUES ($1, $2, $3, $4, 'cliente', true)
            ON CONFLICT DO NOTHING
          `, [user.empresaId, dto.segmentoId, dto.contratoId, ip]);
                    await this.ds.query('UPDATE contratos SET ip_asignada = $1 WHERE id = $2', [ip, dto.contratoId]);
                    ctx.ipAsignada = ip;
                    return `IP asignada del pool: ${ip}`;
                },
            },
            {
                paso: 3,
                nombre: 'Detectar ONU no aprovisionada',
                fn: async () => {
                    ctx.serialNumber = dto.serialNumber;
                    if (ctx.serialNumber) {
                        return `SN proporcionado: ${ctx.serialNumber}`;
                    }
                    const olt = await this.smartoltSvc.findOneOlt(dto.oltId, user.empresaId);
                    if (!olt.smartoltId)
                        throw new Error('El OLT no tiene SmartOLT ID configurado');
                    const onuDetectada = await this.smartoltApi.detectarOnuEnPuerto(olt.smartoltId, dto.ponPort);
                    if (!onuDetectada) {
                        throw new Error(`No se encontró ONU no aprovisionada en el puerto ${dto.ponPort}. ` +
                            `Verifica que la ONU esté conectada.`);
                    }
                    ctx.serialNumber = onuDetectada.serial;
                    return `ONU detectada: SN=${onuDetectada.serial} | PON=${dto.ponPort} | Tipo=${onuDetectada.pon_type}`;
                },
            },
            {
                paso: 4,
                nombre: 'Aprovisionar ONU en SmartOLT',
                fn: async () => {
                    const onu = await this.smartoltSvc.aprovisionarOnu({
                        oltId: dto.oltId,
                        serialNumber: ctx.serialNumber,
                        ponPort: dto.ponPort,
                        perfil: dto.perfil,
                        vlanId: dto.vlanId,
                        descripcion: `${ctx.contrato.cliente_nombre} — ${ctx.contrato.numero_contrato}`,
                        contratoId: dto.contratoId,
                    }, user);
                    ctx.onuId = onu.id;
                    return `ONU aprovisionada: ID=${onu.id} | SN=${ctx.serialNumber} | VLAN=${dto.vlanId}`;
                },
            },
            {
                paso: 5,
                nombre: 'Registrar ONU y asociar al contrato',
                fn: async () => {
                    if (!ctx.onuId)
                        throw new Error('No hay ONU ID para asociar');
                    await this.smartoltSvc.asociarAContrato({ contratoId: dto.contratoId, onuId: ctx.onuId }, user);
                    return `ONU ${ctx.onuId} asociada al contrato ${dto.contratoId}`;
                },
            },
            {
                paso: 6,
                nombre: 'Configurar PPPoE en Mikrotik',
                fn: async () => {
                    if (!ctx.contrato.router_id)
                        throw new Error('Contrato sin router asignado');
                    if (!ctx.usuarioPppoe)
                        throw new Error('Contrato sin usuario PPPoE');
                    const router = ctx.contrato;
                    let password = '';
                    try {
                        password = (0, encryption_util_1.decrypt)(ctx.passwordPppoe || '');
                    }
                    catch {
                        password = ctx.passwordPppoe || '';
                    }
                    const creds = {
                        id: router.router_id,
                        ip: router.router_ip,
                        port: router.usar_ssl ? router.puerto_api_ssl : router.puerto_api,
                        user: router.router_user,
                        passwordCifrado: router.router_pass,
                        useSsl: router.usar_ssl || false,
                        timeoutSec: router.timeout_conexion || 10,
                        version: router.version_ros === 'v7' ? 'v7' : 'v6',
                    };
                    await this.pppoeSvc.crear(creds, {
                        name: ctx.usuarioPppoe,
                        password,
                        profile: router.ppp_profile || 'default',
                        remoteAddress: ctx.ipAsignada,
                        comment: `FibraNet:${dto.contratoId}`,
                    });
                    return `PPPoE creado: ${ctx.usuarioPppoe} | IP remota: ${ctx.ipAsignada}`;
                },
            },
            {
                paso: 7,
                nombre: 'Aplicar control de velocidad (Queue)',
                fn: async () => {
                    const c = ctx.contrato;
                    const creds = {
                        id: c.router_id,
                        ip: c.router_ip,
                        port: c.usar_ssl ? c.puerto_api_ssl : c.puerto_api,
                        user: c.router_user,
                        passwordCifrado: c.router_pass,
                        useSsl: c.usar_ssl || false,
                        timeoutSec: c.timeout_conexion || 10,
                        version: c.version_ros === 'v7' ? 'v7' : 'v6',
                    };
                    const res = await this.velocidadOrc.aplicarVelocidad({
                        routerCreds: creds,
                        clienteId: dto.clienteId,
                        usuarioPppoe: ctx.usuarioPppoe,
                        ipAsignada: ctx.ipAsignada,
                        downloadMbps: c.velocidad_bajada,
                        uploadMbps: c.velocidad_subida,
                        burstDownMbps: c.burst_bajada,
                        burstUpMbps: c.burst_subida,
                        burstTiempoSeg: c.burst_tiempo,
                        tipoQueuePlan: c.tipo_queue || 'simple_queue',
                        tipoPlan: c.tipo_plan || 'residencial',
                    });
                    return `Queue aplicada: ${res.estrategia} | ${c.velocidad_bajada}/${c.velocidad_subida} Mbps | ${res.detalle}`;
                },
            },
            {
                paso: 8,
                nombre: 'Activar contrato y notificar al cliente',
                fn: async () => {
                    await this.ds.query(`
            UPDATE contratos
            SET estado = 'activo',
                fecha_estado = NOW(),
                fecha_instalacion = NOW(),
                motivo_estado = 'Aprovisionamiento FTTH completado'
            WHERE id = $1
          `, [dto.contratoId]);
                    await this.ds.query(`
            INSERT INTO contratos_historial
              (contrato_id, empresa_id, estado_anterior, estado_nuevo, motivo, usuario_id, automatico)
            VALUES ($1, $2, 'pendiente_instalacion', 'activo',
                   'Aprovisionamiento FTTH completado', $3, false)
          `, [dto.contratoId, user.empresaId, user.sub]);
                    if (dto.notificarCliente !== false) {
                        this.events.emit('ftth.cliente.activado', {
                            clienteId: dto.clienteId,
                            contratoId: dto.contratoId,
                            empresaId: user.empresaId,
                            usuarioPppoe: ctx.usuarioPppoe,
                            ipAsignada: ctx.ipAsignada,
                            planNombre: ctx.contrato.plan_nombre,
                            clienteNombre: ctx.contrato.cliente_nombre,
                            clienteTelefono: ctx.contrato.telefono,
                            clienteEmail: ctx.contrato.email,
                        });
                    }
                    resultado.ipAsignada = ctx.ipAsignada;
                    resultado.usuarioPppoe = ctx.usuarioPppoe;
                    resultado.onuId = ctx.onuId;
                    return `Contrato activado | IP: ${ctx.ipAsignada} | Usuario: ${ctx.usuarioPppoe} | Notificación: ${dto.notificarCliente !== false ? 'enviada' : 'omitida'}`;
                },
            },
        ];
        this.logger.log(`Iniciando flujo FTTH: contrato=${dto.contratoId} | ` +
            `OLT=${dto.oltId} | PON=${dto.ponPort} | por: ${user.email}`);
        let ultimoPasoExitoso = 0;
        for (const paso of pasos) {
            const inicio = Date.now();
            try {
                const detalle = await paso.fn();
                const dur = Date.now() - inicio;
                resultado.pasos.push({
                    paso: paso.paso,
                    nombre: paso.nombre,
                    estado: 'ok',
                    detalle,
                    duracionMs: dur,
                });
                ultimoPasoExitoso = paso.paso;
                this.logger.log(`✓ Paso ${paso.paso} [${dur}ms]: ${detalle}`);
            }
            catch (error) {
                const dur = Date.now() - inicio;
                resultado.pasos.push({
                    paso: paso.paso,
                    nombre: paso.nombre,
                    estado: 'error',
                    detalle: error.message,
                    duracionMs: dur,
                });
                this.logger.error(`✗ Paso ${paso.paso} [${dur}ms]: ${error.message}`);
                for (const restante of pasos.slice(paso.paso)) {
                    resultado.pasos.push({
                        paso: restante.paso,
                        nombre: restante.nombre,
                        estado: 'omitido',
                        detalle: `Omitido por fallo en paso ${paso.paso}`,
                    });
                }
                resultado.exitoso = false;
                resultado.mensajeFinal = `Flujo FTTH interrumpido en paso ${paso.paso}: ${error.message}`;
                await this.auditoria.log({
                    empresaId: user.empresaId,
                    usuarioId: user.sub,
                    usuarioEmail: user.email,
                    accion: 'FTTH_FAILED',
                    modulo: 'smartolt',
                    entidadId: dto.contratoId,
                    descripcion: `Fallo en paso ${paso.paso}: ${error.message}`,
                });
                return resultado;
            }
        }
        resultado.exitoso = true;
        resultado.mensajeFinal = `✅ Aprovisionamiento FTTH completado en ${ultimoPasoExitoso} pasos`;
        const duracionTotal = resultado.pasos.reduce((acc, p) => acc + (p.duracionMs || 0), 0);
        this.logger.log(`Flujo FTTH completado: contrato ${dto.contratoId} | ` +
            `${duracionTotal}ms total | IP: ${ctx.ipAsignada}`);
        await this.auditoria.log({
            empresaId: user.empresaId,
            usuarioId: user.sub,
            usuarioEmail: user.email,
            accion: 'FTTH_PROVISIONED',
            modulo: 'smartolt',
            entidadId: dto.contratoId,
            descripcion: `Aprovisionamiento FTTH completado: ${ctx.usuarioPppoe} | IP: ${ctx.ipAsignada}`,
        });
        return resultado;
    }
};
exports.OrquestadorFtthService = OrquestadorFtthService;
exports.OrquestadorFtthService = OrquestadorFtthService = OrquestadorFtthService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(8, (0, typeorm_1.InjectDataSource)()),
    __metadata("design:paramtypes", [smartolt_service_1.SmartoltService,
        smartolt_api_service_1.SmartoltApiService,
        mikrotik_service_1.MikrotikService,
        pppoe_service_1.PppoeService,
        velocidad_orquestador_service_1.VelocidadOrquestador,
        firewall_service_1.FirewallService,
        auditoria_service_1.AuditoriaService, typeof (_a = typeof event_emitter_1.EventEmitter !== "undefined" && event_emitter_1.EventEmitter) === "function" ? _a : Object, typeorm_2.DataSource])
], OrquestadorFtthService);
//# sourceMappingURL=orquestador-ftth.service.js.map