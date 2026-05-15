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
var CobranzaScheduler_1, CobranzaWorker_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CobranzaWorker = exports.CobranzaScheduler = void 0;
const bull_1 = require("@nestjs/bull");
const common_1 = require("@nestjs/common");
const bull_2 = require("@nestjs/bull");
const schedule_1 = require("@nestjs/schedule");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const event_emitter_1 = require("@nestjs/event-emitter");
const firewall_service_1 = require("../mikrotik/services/firewall.service");
const pppoe_service_1 = require("../mikrotik/services/pppoe.service");
const whatsapp_service_1 = require("../notificaciones/services/whatsapp.service");
const facturacion_service_1 = require("../facturacion/facturacion.service");
const auditoria_service_1 = require("../auth/auditoria.service");
const workers_constants_1 = require("./workers.constants");
const encryption_util_1 = require("../../common/utils/encryption.util");
let CobranzaScheduler = CobranzaScheduler_1 = class CobranzaScheduler {
    constructor(queue, ds) {
        this.queue = queue;
        this.ds = ds;
        this.logger = new common_1.Logger(CobranzaScheduler_1.name);
    }
    async detectarMorosos() {
        this.logger.log('[CRON] Iniciando detección diaria de morosos');
        const morosos = await this.ds.query(`
      SELECT
        co.id              AS contrato_id,
        co.empresa_id,
        co.cliente_id,
        co.router_id,
        co.ip_asignada,
        co.usuario_pppoe,
        co.deuda_total,
        co.meses_deuda,
        co.en_prorroga,
        co.prorroga_hasta,
        co.estado,
        em.dias_gracia_corte,
        em.notif_whatsapp_corte,
        EXTRACT(DAY FROM (NOW() - COALESCE(co.fecha_ultimo_pago, co.fecha_inicio)::timestamptz))::int
          AS dias_sin_pago
      FROM contratos co
      JOIN empresas em ON em.id = co.empresa_id
      WHERE co.estado IN ('activo', 'prorroga')
        AND co.deuda_total > 0
        AND co.deleted_at IS NULL
        AND co.router_id IS NOT NULL
        AND co.ip_asignada IS NOT NULL
        AND co.usuario_pppoe IS NOT NULL
      ORDER BY co.deuda_total DESC
    `);
        let suspender = 0;
        let omitidos = 0;
        for (const c of morosos) {
            const diasGracia = parseInt(c.dias_gracia_corte || '5', 10);
            if (c.en_prorroga && c.prorroga_hasta) {
                const venceProrroga = new Date(c.prorroga_hasta);
                if (venceProrroga > new Date()) {
                    omitidos++;
                    continue;
                }
                await this.queue.add(workers_constants_1.JOBS.VENCER_PRORROGA, {
                    contratoId: c.contrato_id,
                    empresaId: c.empresa_id,
                    clienteId: c.cliente_id,
                    prorrogaHasta: c.prorroga_hasta,
                }, workers_constants_1.JOB_OPTIONS.CRITICO);
            }
            if (parseInt(c.dias_sin_pago, 10) > diasGracia) {
                await this.queue.add(workers_constants_1.JOBS.SUSPENDER_CONTRATO, {
                    contratoId: c.contrato_id,
                    empresaId: c.empresa_id,
                    clienteId: c.cliente_id,
                    routerId: c.router_id,
                    ipAsignada: c.ip_asignada,
                    usuarioPppoe: c.usuario_pppoe,
                    deudaTotal: parseFloat(c.deuda_total),
                    mesesDeuda: parseInt(c.meses_deuda, 10),
                    notificar: c.notif_whatsapp_corte,
                }, {
                    ...workers_constants_1.JOB_OPTIONS.CRITICO,
                    delay: suspender * 1000,
                });
                suspender++;
            }
        }
        this.logger.log(`[CRON] Detección morosos: ${morosos.length} encontrados | ` +
            `${suspender} a suspender | ${omitidos} en prórroga vigente`);
    }
    async verificarProrrogasVencidas() {
        const hoy = new Date().toISOString().split('T')[0];
        const prorrogasVencidas = await this.ds.query(`
      SELECT co.id, co.empresa_id, co.cliente_id, co.router_id,
             co.ip_asignada, co.usuario_pppoe, co.deuda_total,
             co.meses_deuda, co.prorroga_hasta
      FROM contratos co
      WHERE co.en_prorroga = true
        AND co.prorroga_hasta < $1
        AND co.estado = 'prorroga'
        AND co.deleted_at IS NULL
    `, [hoy]);
        for (const c of prorrogasVencidas) {
            await this.queue.add(workers_constants_1.JOBS.VENCER_PRORROGA, {
                contratoId: c.id,
                empresaId: c.empresa_id,
                clienteId: c.cliente_id,
                prorrogaHasta: c.prorroga_hasta,
            }, workers_constants_1.JOB_OPTIONS.CRITICO);
        }
        if (prorrogasVencidas.length) {
            this.logger.log(`[CRON] ${prorrogasVencidas.length} prórrogas vencidas encoladas para suspensión`);
        }
    }
    async notificacionesPreventivas() {
        for (const diasAntes of [3, 1]) {
            const fecha = new Date();
            fecha.setDate(fecha.getDate() + diasAntes);
            const fechaStr = fecha.toISOString().split('T')[0];
            const porVencer = await this.ds.query(`
        SELECT co.id, co.empresa_id, co.cliente_id,
               cl.nombre_completo, cl.whatsapp, cl.telefono,
               co.deuda_total
        FROM contratos co
        JOIN clientes cl ON cl.id = co.cliente_id
        JOIN empresas em ON em.id = co.empresa_id
        WHERE co.estado = 'activo'
          AND co.deuda_total > 0
          AND co.deleted_at IS NULL
          AND em.notif_whatsapp_vencimiento = true
          AND (cl.whatsapp IS NOT NULL OR cl.telefono IS NOT NULL)
        LIMIT 1000
      `);
            for (const c of porVencer) {
                await this.queue.add(workers_constants_1.JOBS.NOTIF_COBRO_PREVIO, {
                    clienteId: c.cliente_id,
                    empresaId: c.empresa_id,
                    telefono: c.whatsapp || c.telefono,
                    nombre: c.nombre_completo,
                    montoDeuda: parseFloat(c.deuda_total),
                    diasAntes,
                    facturaIds: [],
                }, workers_constants_1.JOB_OPTIONS.NOTIFICACION);
            }
        }
    }
    async enqueueReactivacion(payload) {
        await this.queue.add(workers_constants_1.JOBS.REACTIVAR_CONTRATO, payload, workers_constants_1.JOB_OPTIONS.CRITICO);
        this.logger.log(`Reactivación encolada: contrato ${payload.contratoId}`);
    }
    async enqueueProcesarPago(payload) {
        await this.queue.add(workers_constants_1.JOBS.PROCESAR_PAGO, payload, {
            ...workers_constants_1.JOB_OPTIONS.CRITICO,
            priority: 1,
        });
    }
};
exports.CobranzaScheduler = CobranzaScheduler;
__decorate([
    (0, schedule_1.Cron)('0 6 * * *', { timeZone: 'America/Lima', name: 'deteccion-morosos' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CobranzaScheduler.prototype, "detectarMorosos", null);
__decorate([
    (0, schedule_1.Cron)('0 */2 * * *', { timeZone: 'America/Lima', name: 'prorrogas-vencidas' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CobranzaScheduler.prototype, "verificarProrrogasVencidas", null);
__decorate([
    (0, schedule_1.Cron)('0 8 * * *', { timeZone: 'America/Lima', name: 'notif-preventivas' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CobranzaScheduler.prototype, "notificacionesPreventivas", null);
exports.CobranzaScheduler = CobranzaScheduler = CobranzaScheduler_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, bull_2.InjectQueue)(workers_constants_1.QUEUES.COBRANZA)),
    __param(1, (0, typeorm_1.InjectDataSource)()),
    __metadata("design:paramtypes", [Object, typeorm_2.DataSource])
], CobranzaScheduler);
let CobranzaWorker = CobranzaWorker_1 = class CobranzaWorker {
    constructor(firewallSvc, pppoeSvc, whatsappSvc, facturacionSvc, auditoria, events, ds) {
        this.firewallSvc = firewallSvc;
        this.pppoeSvc = pppoeSvc;
        this.whatsappSvc = whatsappSvc;
        this.facturacionSvc = facturacionSvc;
        this.auditoria = auditoria;
        this.events = events;
        this.ds = ds;
        this.logger = new common_1.Logger(CobranzaWorker_1.name);
    }
    async processSuspenderContrato(job) {
        const { contratoId, empresaId, clienteId, routerId, ipAsignada, usuarioPppoe, deudaTotal, notificar } = job.data;
        this.logger.log(`[SUSPENDER] Contrato ${contratoId} | IP: ${ipAsignada} | Deuda: S/ ${deudaTotal}`);
        const errores = [];
        const [router] = await this.ds.query(`
      SELECT ip_gestion, usuario, password_cifrado, usar_ssl,
             puerto_api, puerto_api_ssl, version_ros, timeout_conexion
      FROM routers WHERE id = $1
    `, [routerId]).catch(() => [null]);
        if (router) {
            const creds = this.buildCreds(routerId, router);
            await job.progress(20);
            try {
                await this.firewallSvc.suspenderCliente(creds, ipAsignada, clienteId, `Mora S/ ${deudaTotal} — ${new Date().toLocaleDateString('es-PE')}`);
                this.logger.log(`✓ IP ${ipAsignada} en lista morosos | router: ${router.ip_gestion}`);
            }
            catch (err) {
                errores.push(`Firewall: ${err.message}`);
                this.logger.error(`✗ Error Address List ${ipAsignada}: ${err.message}`);
            }
            await job.progress(40);
            try {
                await this.pppoeSvc.desconectarSesion(creds, usuarioPppoe);
                this.logger.log(`✓ Sesión PPPoE desconectada: ${usuarioPppoe}`);
            }
            catch (err) {
                errores.push(`PPPoE disconnect: ${err.message}`);
                this.logger.warn(`✗ No se pudo desconectar sesión ${usuarioPppoe}: ${err.message}`);
            }
        }
        else {
            errores.push(`Router ${routerId} no encontrado`);
        }
        await job.progress(60);
        await this.ds.query(`
      UPDATE contratos SET
        estado = 'suspendido_mora',
        fecha_estado = NOW(),
        motivo_estado = $1
      WHERE id = $2 AND estado IN ('activo', 'prorroga')
    `, [
            `Suspensión automática: S/ ${deudaTotal} de deuda | ${new Date().toLocaleDateString('es-PE')}`,
            contratoId,
        ]);
        await this.ds.query(`
      INSERT INTO contratos_historial
        (contrato_id, empresa_id, estado_anterior, estado_nuevo, motivo, usuario_id, automatico)
      VALUES ($1, $2, 'activo', 'suspendido_mora', $3, 'sistema', true)
    `, [contratoId, empresaId, `Corte automático: deuda S/ ${deudaTotal}`]);
        await job.progress(80);
        if (notificar) {
            const [cliente] = await this.ds.query(`
        SELECT cl.nombre_completo, cl.whatsapp, cl.telefono,
               em.razon_social AS empresa_nombre
        FROM contratos co
        JOIN clientes cl ON cl.id = co.cliente_id
        JOIN empresas em ON em.id = co.empresa_id
        WHERE co.id = $1
      `, [contratoId]).catch(() => [null]);
            if (cliente) {
                const tel = cliente.whatsapp || cliente.telefono;
                if (tel) {
                    await this.whatsappSvc.notificarServicioSuspendido({
                        telefono: tel,
                        clienteNombre: cliente.nombre_completo,
                        deudaTotal,
                        nombreEmpresa: cliente.empresa_nombre,
                    }).catch((err) => this.logger.warn(`WhatsApp suspensión falló: ${err.message}`));
                }
            }
        }
        await job.progress(100);
        await this.auditoria.log({
            empresaId,
            accion: 'AUTO_SUSPEND',
            modulo: 'cobranza',
            entidadId: contratoId,
            descripcion: `Suspensión automática: IP ${ipAsignada} | Deuda: S/ ${deudaTotal} | Errores: ${errores.length}`,
        });
        this.events.emit('mikrotik.cliente.suspendido', {
            clienteId, empresaId, ip: ipAsignada, routerId, contratoId,
        });
        this.logger.log(`[SUSPENDER] ✅ Contrato ${contratoId} suspendido | ` +
            `${errores.length ? `ERRORES: ${errores.join(', ')}` : 'sin errores'}`);
        return { contratoId, ipAsignada, errores };
    }
    async processReactivarContrato(job) {
        const { contratoId, empresaId, clienteId, routerId, ipAsignada, planNombre, notificar } = job.data;
        this.logger.log(`[REACTIVAR] Contrato ${contratoId} | IP: ${ipAsignada}`);
        const errores = [];
        const [router] = await this.ds.query('SELECT ip_gestion, usuario, password_cifrado, usar_ssl, puerto_api, puerto_api_ssl, version_ros, timeout_conexion FROM routers WHERE id = $1', [routerId]).catch(() => [null]);
        if (router) {
            const creds = this.buildCreds(routerId, router);
            await job.progress(25);
            try {
                await this.firewallSvc.reactivarCliente(creds, ipAsignada);
                this.logger.log(`✓ IP ${ipAsignada} removida de listas de control`);
            }
            catch (err) {
                errores.push(`Firewall: ${err.message}`);
                this.logger.error(`✗ Error removiendo ${ipAsignada} de Address List: ${err.message}`);
            }
            await job.progress(50);
        }
        else {
            errores.push(`Router ${routerId} no encontrado`);
            this.logger.warn(`Router ${routerId} no encontrado para reactivar ${contratoId}`);
        }
        await job.progress(70);
        await this.ds.query(`
      UPDATE contratos SET
        estado = 'activo',
        fecha_estado = NOW(),
        motivo_estado = 'Reactivación automática por pago registrado',
        en_prorroga = false
      WHERE id = $1 AND estado IN ('suspendido_mora', 'prorroga')
    `, [contratoId]);
        await this.ds.query(`
      INSERT INTO contratos_historial
        (contrato_id, empresa_id, estado_anterior, estado_nuevo, motivo, usuario_id, automatico)
      VALUES ($1, $2, 'suspendido_mora', 'activo', 'Reactivación automática por pago', 'sistema', true)
    `, [contratoId, empresaId]);
        await job.progress(85);
        if (notificar !== false) {
            const [cliente] = await this.ds.query(`
        SELECT cl.nombre_completo, cl.whatsapp, cl.telefono
        FROM contratos co JOIN clientes cl ON cl.id = co.cliente_id
        WHERE co.id = $1
      `, [contratoId]).catch(() => [null]);
            if (cliente) {
                const tel = cliente.whatsapp || cliente.telefono;
                if (tel) {
                    await this.whatsappSvc.notificarServicioReactivado({
                        telefono: tel,
                        clienteNombre: cliente.nombre_completo,
                        planNombre: planNombre || 'tu plan',
                    }).catch((err) => this.logger.warn(`WhatsApp reactivación fallido: ${err.message}`));
                }
            }
        }
        await job.progress(100);
        this.events.emit('mikrotik.cliente.reactivado', {
            clienteId, empresaId, ip: ipAsignada, routerId, contratoId,
        });
        await this.auditoria.log({
            empresaId,
            accion: 'AUTO_REACTIVATE',
            modulo: 'cobranza',
            entidadId: contratoId,
            descripcion: `Reactivación automática: IP ${ipAsignada} | Errores: ${errores.length}`,
        });
        this.logger.log(`[REACTIVAR] ✅ Contrato ${contratoId} reactivado | ` +
            `${errores.length ? `ERRORES: ${errores.join(', ')}` : 'sin errores'}`);
        return { contratoId, ipAsignada, errores };
    }
    async processVencerProrroga(job) {
        const { contratoId, empresaId, clienteId, prorrogaHasta } = job.data;
        this.logger.log(`[PRORROGA] Verificando vencimiento: contrato ${contratoId} | hasta: ${prorrogaHasta}`);
        const [contrato] = await this.ds.query(`
      SELECT co.id, co.deuda_total, co.router_id,
             co.ip_asignada, co.usuario_pppoe, co.meses_deuda, co.estado
      FROM contratos co
      WHERE co.id = $1 AND co.deleted_at IS NULL
    `, [contratoId]);
        if (!contrato) {
            this.logger.warn(`Contrato ${contratoId} no encontrado para evaluar prórroga`);
            return { omitido: true };
        }
        if (contrato.estado !== 'prorroga' || parseFloat(contrato.deuda_total) <= 0) {
            this.logger.log(`Contrato ${contratoId}: prórroga ya resuelta o sin deuda`);
            return { omitido: true };
        }
        await this.enqueueCobranza(workers_constants_1.JOBS.SUSPENDER_CONTRATO, {
            contratoId,
            empresaId,
            clienteId,
            routerId: contrato.router_id,
            ipAsignada: contrato.ip_asignada,
            usuarioPppoe: contrato.usuario_pppoe,
            deudaTotal: parseFloat(contrato.deuda_total),
            mesesDeuda: contrato.meses_deuda,
            notificar: true,
        });
        this.logger.log(`[PRORROGA] ✅ Prórroga vencida el ${prorrogaHasta} — suspensión encolada para ${contratoId}`);
        return { contratoId, prorrogaHasta, accion: 'suspendido' };
    }
    async processPago(job) {
        const { pagoId, facturaId, contratoId, empresaId, montoPago, fechaPago } = job.data;
        this.logger.log(`[PAGO] Procesando: pago=${pagoId} | factura=${facturaId} | monto=S/${montoPago}`);
        await job.progress(25);
        const facturaActualizada = await this.facturacionSvc.aplicarPago(facturaId, montoPago, empresaId, fechaPago);
        await job.progress(50);
        const [deudaRow] = await this.ds.query(`
      SELECT
        COALESCE(SUM(saldo), 0)::DECIMAL AS deuda,
        COUNT(*) FILTER (WHERE estado IN ('emitida','pagada_parcial','vencida','en_cobranza'))::INT AS meses
      FROM facturas
      WHERE contrato_id = $1 AND estado != 'anulada' AND deleted_at IS NULL
    `, [contratoId]);
        const nuevaDeuda = parseFloat(deudaRow?.deuda || '0');
        const nuevosMeses = parseInt(deudaRow?.meses || '0', 10);
        await this.ds.query(`
      UPDATE contratos SET deuda_total = $1, meses_deuda = $2, fecha_ultimo_pago = $3
      WHERE id = $4
    `, [nuevaDeuda, nuevosMeses, fechaPago, contratoId]);
        await job.progress(75);
        if (nuevaDeuda <= 0) {
            const [contrato] = await this.ds.query(`
        SELECT co.estado, co.router_id, co.ip_asignada,
               pl.nombre AS plan_nombre, cl.whatsapp, cl.telefono
        FROM contratos co
        JOIN planes  pl ON pl.id = co.plan_id
        JOIN clientes cl ON cl.id = co.cliente_id
        WHERE co.id = $1
      `, [contratoId]);
            if (contrato && ['suspendido_mora', 'prorroga'].includes(contrato.estado)) {
                await this.enqueueCobranza(workers_constants_1.JOBS.REACTIVAR_CONTRATO, {
                    contratoId,
                    empresaId,
                    clienteId: job.data.facturaId,
                    routerId: contrato.router_id,
                    ipAsignada: contrato.ip_asignada,
                    planNombre: contrato.plan_nombre,
                    notificar: true,
                }, { priority: 1 });
                this.logger.log(`[PAGO] 💰 Deuda saldada → reactivación encolada para contrato ${contratoId}`);
            }
        }
        await job.progress(100);
        this.logger.log(`[PAGO] ✅ Pago ${pagoId} procesado | ` +
            `nueva deuda: S/ ${nuevaDeuda} | ${nuevosMeses} facturas pendientes`);
        return { pagoId, contratoId, nuevaDeuda, reactivar: nuevaDeuda <= 0 };
    }
    async processNotifCobro(job) {
        const { telefono, nombre, montoDeuda, diasAntes } = job.data;
        if (!telefono || !montoDeuda)
            return { omitido: true };
        await this.whatsappSvc.notificarPagoRecibido({
            telefono,
            clienteNombre: nombre,
            montoPago: 0,
            metodoPago: 'pendiente',
            saldoPendiente: montoDeuda,
        }).catch((err) => this.logger.warn(`WhatsApp previo: ${err.message}`));
        return { enviado: true };
    }
    onFailed(job, error) {
        this.logger.error(`[COBRANZA] ❌ Job ${job.name} #${job.id} falló ` +
            `(intento ${job.attemptsMade}/${job.opts.attempts}): ${error.message}`, error.stack);
    }
    onCompleted(job, result) {
        if (result?.errores?.length) {
            this.logger.warn(`[COBRANZA] ⚠️ Job ${job.name} #${job.id} completado con errores: ` +
                result.errores.join(', '));
        }
    }
    onStalled(job) {
        this.logger.warn(`[COBRANZA] ⏸ Job ${job.name} #${job.id} estancado — reencolando`);
    }
    buildCreds(routerId, router) {
        let password = '';
        try {
            password = (0, encryption_util_1.decrypt)(router.password_cifrado);
        }
        catch {
            password = router.password_cifrado;
        }
        return {
            id: routerId,
            ip: router.ip_gestion,
            port: router.usar_ssl ? router.puerto_api_ssl : router.puerto_api,
            user: router.usuario,
            passwordCifrado: router.password_cifrado,
            useSsl: router.usar_ssl || false,
            timeoutSec: router.timeout_conexion || 10,
            version: (router.version_ros === 'v7' ? 'v7' : 'v6'),
        };
    }
    async enqueueCobranza(jobName, payload, opts = workers_constants_1.JOB_OPTIONS.CRITICO) {
        const queue = this['queue'];
        if (queue)
            await queue.add(jobName, payload, opts);
    }
};
exports.CobranzaWorker = CobranzaWorker;
__decorate([
    (0, bull_1.Process)({ name: workers_constants_1.JOBS.SUSPENDER_CONTRATO, concurrency: 5 }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CobranzaWorker.prototype, "processSuspenderContrato", null);
__decorate([
    (0, bull_1.Process)({ name: workers_constants_1.JOBS.REACTIVAR_CONTRATO, concurrency: 5 }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CobranzaWorker.prototype, "processReactivarContrato", null);
__decorate([
    (0, bull_1.Process)({ name: workers_constants_1.JOBS.VENCER_PRORROGA, concurrency: 3 }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CobranzaWorker.prototype, "processVencerProrroga", null);
__decorate([
    (0, bull_1.Process)({ name: workers_constants_1.JOBS.PROCESAR_PAGO, concurrency: 10 }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CobranzaWorker.prototype, "processPago", null);
__decorate([
    (0, bull_1.Process)({ name: workers_constants_1.JOBS.NOTIF_COBRO_PREVIO, concurrency: 20 }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CobranzaWorker.prototype, "processNotifCobro", null);
__decorate([
    (0, bull_1.OnQueueFailed)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Error]),
    __metadata("design:returntype", void 0)
], CobranzaWorker.prototype, "onFailed", null);
__decorate([
    (0, bull_1.OnQueueCompleted)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], CobranzaWorker.prototype, "onCompleted", null);
__decorate([
    (0, bull_1.OnQueueStalled)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CobranzaWorker.prototype, "onStalled", null);
exports.CobranzaWorker = CobranzaWorker = CobranzaWorker_1 = __decorate([
    (0, bull_1.Processor)(workers_constants_1.QUEUES.COBRANZA),
    __param(6, (0, typeorm_1.InjectDataSource)()),
    __metadata("design:paramtypes", [firewall_service_1.FirewallService,
        pppoe_service_1.PppoeService,
        whatsapp_service_1.WhatsAppService,
        facturacion_service_1.FacturacionService,
        auditoria_service_1.AuditoriaService,
        event_emitter_1.EventEmitter2,
        typeorm_2.DataSource])
], CobranzaWorker);
//# sourceMappingURL=cobranza.worker.js.map