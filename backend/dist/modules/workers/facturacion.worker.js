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
var FacturacionScheduler_1, FacturacionWorker_1;
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.FacturacionWorker = exports.FacturacionScheduler = void 0;
const bull_1 = require("@nestjs/bull");
const common_1 = require("@nestjs/common");
const bull_2 = require("@nestjs/bull");
const schedule_1 = require("@nestjs/schedule");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const event_emitter_1 = require("@nestjs/event-emitter");
const facturacion_service_1 = require("../facturacion/facturacion.service");
const whatsapp_service_1 = require("../notificaciones/services/whatsapp.service");
const auditoria_service_1 = require("../auth/auditoria.service");
const workers_constants_1 = require("./workers.constants");
let FacturacionScheduler = FacturacionScheduler_1 = class FacturacionScheduler {
    constructor(queue, ds) {
        this.queue = queue;
        this.ds = ds;
        this.logger = new common_1.Logger(FacturacionScheduler_1.name);
    }
    async scheduleFacturacionDiaria() {
        const hoy = new Date();
        const diaHoy = hoy.getDate();
        const mes = hoy.getMonth() + 1;
        const anio = hoy.getFullYear();
        this.logger.log(`[FACTURACION-CRON] Día ${diaHoy}/${mes}/${anio} — verificando empresas a facturar`);
        await this.queue.add(workers_constants_1.JOBS.MARCAR_FACTURAS_VENCIDAS, { fecha: hoy.toISOString().split('T')[0] }, { ...workers_constants_1.JOB_OPTIONS.CRITICO, priority: 1 });
        const empresas = await this.ds.query(`
      SELECT id, razon_social, dia_facturacion, serie_boleta, igv_rate
      FROM empresas
      WHERE estado = 'activo'
        AND dia_facturacion = $1
        AND deleted_at IS NULL
    `, [diaHoy]);
        for (const emp of empresas) {
            await this.queue.add(workers_constants_1.JOBS.GENERAR_FACTURAS_EMPRESA, {
                empresaId: emp.id,
                mes,
                anio,
                diaFacturacion: diaHoy,
                forzar: false,
            }, {
                ...workers_constants_1.JOB_OPTIONS.MASIVO,
                delay: empresas.indexOf(emp) * 5000,
            });
        }
        this.logger.log(`[FACTURACION-CRON] ${empresas.length} empresas encoladas para facturar ` +
            `(día ${diaHoy} del mes ${mes}/${anio})`);
    }
    async enqueueGeneracionManual(empresaId, mes, anio, forzar = false) {
        const job = await this.queue.add(workers_constants_1.JOBS.GENERAR_FACTURAS_EMPRESA, { empresaId, mes, anio, forzar }, { ...workers_constants_1.JOB_OPTIONS.MASIVO, priority: 1 });
        this.logger.log(`Generación manual encolada: empresa ${empresaId} | ${mes}/${anio} | job: ${job.id}`);
        return String(job.id);
    }
    async getEstadoCola() {
        return this.queue.getJobCounts();
    }
};
exports.FacturacionScheduler = FacturacionScheduler;
__decorate([
    (0, schedule_1.Cron)('5 0 * * *', { timeZone: 'America/Lima', name: 'facturacion-diaria' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], FacturacionScheduler.prototype, "scheduleFacturacionDiaria", null);
exports.FacturacionScheduler = FacturacionScheduler = FacturacionScheduler_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, bull_2.InjectQueue)(workers_constants_1.QUEUES.FACTURACION)),
    __param(1, (0, typeorm_1.InjectDataSource)()),
    __metadata("design:paramtypes", [Object, typeorm_2.DataSource])
], FacturacionScheduler);
let FacturacionWorker = FacturacionWorker_1 = class FacturacionWorker {
    constructor(facturacionSvc, whatsappSvc, auditoria, events, ds) {
        this.facturacionSvc = facturacionSvc;
        this.whatsappSvc = whatsappSvc;
        this.auditoria = auditoria;
        this.events = events;
        this.ds = ds;
        this.logger = new common_1.Logger(FacturacionWorker_1.name);
    }
    async processGenerarFacturasEmpresa(job) {
        const { empresaId, mes, anio, forzar } = job.data;
        this.logger.log(`[FACTURACION] 🏢 Empresa ${empresaId} | ${mes}/${anio} | forzar: ${forzar}`);
        await job.progress(5);
        const [empresa] = await this.ds.query('SELECT id, razon_social, igv_rate, serie_boleta, serie_factura FROM empresas WHERE id = $1', [empresaId]);
        if (!empresa) {
            throw new Error(`Empresa ${empresaId} no encontrada`);
        }
        const contratos = await this.ds.query(`
      SELECT
        co.id              AS contrato_id,
        co.numero_contrato,
        co.cliente_id,
        co.precio_final    AS precio,
        co.dia_facturacion,
        cl.nombre_completo AS cliente_nombre,
        cl.whatsapp,
        cl.telefono,
        cl.email,
        pl.aplica_igv,
        pl.nombre          AS plan_nombre
      FROM contratos co
      JOIN clientes cl ON cl.id = co.cliente_id
      JOIN planes   pl ON pl.id = co.plan_id
      WHERE co.empresa_id = $1
        AND co.estado IN ('activo', 'prorroga')
        AND co.deleted_at IS NULL
      ORDER BY co.dia_facturacion, cl.nombre_completo
    `, [empresaId]);
        const resultado = {
            empresaId,
            mes, anio,
            total: contratos.length,
            exitosas: 0,
            omitidas: 0,
            errores: 0,
            montoTotal: 0,
            detalles: [],
        };
        await job.progress(10);
        const periodoInicio = `${anio}-${String(mes).padStart(2, '0')}-01`;
        const periodoFin = this.ultimoDiaMes(anio, mes);
        const igvRate = parseFloat(empresa.igv_rate || '0.18');
        const totalContratos = contratos.length;
        for (let i = 0; i < contratos.length; i++) {
            const contrato = contratos[i];
            try {
                await job.progress(10 + Math.floor((i / totalContratos) * 80));
                if (!forzar) {
                    const [existente] = await this.ds.query(`
            SELECT id FROM facturas
            WHERE contrato_id = $1
              AND periodo_inicio = $2
              AND periodo_fin    = $3
              AND estado != 'anulada'
              AND deleted_at IS NULL
          `, [contrato.contrato_id, periodoInicio, periodoFin]);
                    if (existente) {
                        resultado.omitidas++;
                        resultado.detalles.push({
                            contratoId: contrato.contrato_id,
                            resultado: `Omitido — factura ${existente.id} ya existe para ${mes}/${anio}`,
                        });
                        continue;
                    }
                }
                const precioBase = parseFloat(contrato.precio || '0');
                const aplicaIgv = contrato.aplica_igv === true || contrato.aplica_igv === 'true';
                const subtotal = aplicaIgv
                    ? Math.round((precioBase / (1 + igvRate)) * 100) / 100
                    : precioBase;
                const igv = aplicaIgv ? Math.round((precioBase - subtotal) * 100) / 100 : 0;
                const total = Math.round(precioBase * 100) / 100;
                const serie = empresa.serie_boleta || 'B001';
                const [[{ siguiente }]] = await this.ds.query(`
          SELECT COALESCE(MAX(correlativo), 0) + 1 AS siguiente
          FROM facturas
          WHERE empresa_id = $1 AND serie = $2 AND deleted_at IS NULL
        `, [empresaId, serie]);
                const correlativo = parseInt(siguiente, 10);
                const diaVenc = Math.min((contrato.dia_facturacion || 1) + 5, 28);
                const fechaVencimiento = `${anio}-${String(mes).padStart(2, '0')}-${String(diaVenc).padStart(2, '0')}`;
                const [factura] = await this.ds.query(`
          INSERT INTO facturas (
            empresa_id, cliente_id, contrato_id,
            tipo_comprobante, serie, correlativo,
            periodo_inicio, periodo_fin,
            descripcion, subtotal, descuento, igv, total,
            monto_pagado, estado, fecha_emision, fecha_vencimiento,
            moneda, generada_automaticamente, items, created_at
          ) VALUES (
            $1, $2, $3,
            'boleta', $4, $5,
            $6, $7,
            $8, $9, 0, $10, $11,
            0, 'emitida', CURRENT_DATE, $12,
            'PEN', true, $13, NOW()
          )
          RETURNING id, numero_completo
        `, [
                    empresaId, contrato.cliente_id, contrato.contrato_id,
                    serie, correlativo,
                    periodoInicio, periodoFin,
                    `${contrato.plan_nombre} — ${this.mesNombre(mes)} ${anio}`,
                    subtotal, igv, total,
                    fechaVencimiento,
                    JSON.stringify([{
                            descripcion: `${contrato.plan_nombre} — ${this.mesNombre(mes)} ${anio}`,
                            cantidad: 1,
                            precioUnitario: subtotal,
                            subtotal,
                        }]),
                ]);
                await this.ds.query(`
          UPDATE contratos SET
            deuda_total = COALESCE(deuda_total, 0) + $1,
            meses_deuda = COALESCE(meses_deuda, 0) + 1
          WHERE id = $2
        `, [total, contrato.contrato_id]);
                resultado.exitosas++;
                resultado.montoTotal += total;
                resultado.detalles.push({
                    contratoId: contrato.contrato_id,
                    resultado: `${serie}-${String(correlativo).padStart(8, '0')} | S/ ${total.toFixed(2)}`,
                });
                const tel = contrato.whatsapp || contrato.telefono;
                if (tel) {
                    this.whatsappSvc.notificarFacturaEmitida({
                        telefono: tel,
                        clienteNombre: contrato.cliente_nombre,
                        numeroFactura: `${serie}-${String(correlativo).padStart(8, '0')}`,
                        montoTotal: total,
                        fechaVencimiento,
                    }).catch((err) => this.logger.debug(`WhatsApp factura: ${err.message}`));
                }
            }
            catch (err) {
                resultado.errores++;
                resultado.detalles.push({
                    contratoId: contrato.contrato_id,
                    resultado: 'error',
                    error: err.message,
                });
                this.logger.error(`Error generando factura contrato ${contrato.numero_contrato}: ${err.message}`);
            }
        }
        await job.progress(95);
        await this.auditoria.log({
            empresaId,
            accion: 'BULK_INVOICE',
            modulo: 'facturacion',
            descripcion: `Generación masiva ${mes}/${anio}: ` +
                `${resultado.exitosas} exitosas | ${resultado.omitidas} omitidas | ` +
                `${resultado.errores} errores | Total: S/ ${resultado.montoTotal.toFixed(2)}`,
        });
        this.events.emit('facturacion.generacion.completada', {
            empresaId, mes, anio,
            exitosas: resultado.exitosas,
            errores: resultado.errores,
            montoTotal: resultado.montoTotal,
        });
        await job.progress(100);
        this.logger.log(`[FACTURACION] ✅ Empresa ${empresa.razon_social} | ${mes}/${anio} completado:\n` +
            `  Total:     ${resultado.total}\n` +
            `  Exitosas:  ${resultado.exitosas}\n` +
            `  Omitidas:  ${resultado.omitidas}\n` +
            `  Errores:   ${resultado.errores}\n` +
            `  Monto:     S/ ${resultado.montoTotal.toFixed(2)}`);
        return resultado;
    }
    async processMarcarVencidas(job) {
        const fecha = job.data.fecha || new Date().toISOString().split('T')[0];
        const result = await this.ds.query(`
      UPDATE facturas
      SET estado = 'vencida'
      WHERE fecha_vencimiento < $1
        AND estado IN ('emitida', 'pagada_parcial')
        AND deleted_at IS NULL
      RETURNING id
    `, [fecha]);
        const marcadas = result.length;
        if (marcadas > 0) {
            this.logger.log(`[VENCIDAS] ${marcadas} facturas marcadas como vencidas (${fecha})`);
            this.events.emit('facturas.vencidas.marcadas', { fecha, marcadas });
        }
        return { marcadas };
    }
    async processGenerarFacturaIndividual(job) {
        const { contratoId, empresaId, mes, anio } = job.data;
        const userSistema = {
            sub: 'sistema', email: 'sistema@fibranet.pe',
            empresaId, roles: ['Administrador'], permisos: [],
            nombreCompleto: 'Sistema', tema: 'dark',
        };
        const resultado = await this.facturacionSvc.generarMensual({ mes, anio, contratoId }, userSistema);
        this.logger.log(`[FACTURA-INDIVIDUAL] Contrato ${contratoId}: ` +
            `${resultado.exitosas} generadas, ${resultado.omitidas} omitidas`);
        return resultado;
    }
    onFailed(job, error) {
        this.logger.error(`[FACTURACION] ❌ Job ${job.name} #${job.id} ` +
            `(intento ${job.attemptsMade}): ${error.message}`, error.stack);
    }
    onCompleted(job, result) {
        if (result?.errores > 0) {
            this.logger.warn(`[FACTURACION] ⚠️ Job ${job.name} completado con ${result.errores} errores`);
        }
        else {
            this.logger.debug(`[FACTURACION] ✅ Job ${job.name} #${job.id} completado`);
        }
    }
    ultimoDiaMes(anio, mes) {
        const ultimo = new Date(anio, mes, 0).getDate();
        return `${anio}-${String(mes).padStart(2, '0')}-${ultimo}`;
    }
    mesNombre(mes) {
        const nombres = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
            'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        return nombres[mes] || '';
    }
};
exports.FacturacionWorker = FacturacionWorker;
__decorate([
    (0, bull_1.Process)({ name: workers_constants_1.JOBS.GENERAR_FACTURAS_EMPRESA, concurrency: 2 }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], FacturacionWorker.prototype, "processGenerarFacturasEmpresa", null);
__decorate([
    (0, bull_1.Process)({ name: workers_constants_1.JOBS.MARCAR_FACTURAS_VENCIDAS, concurrency: 1 }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], FacturacionWorker.prototype, "processMarcarVencidas", null);
__decorate([
    (0, bull_1.Process)({ name: workers_constants_1.JOBS.GENERAR_FACTURA_CONTRATO, concurrency: 5 }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], FacturacionWorker.prototype, "processGenerarFacturaIndividual", null);
__decorate([
    (0, bull_1.OnQueueFailed)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Error]),
    __metadata("design:returntype", void 0)
], FacturacionWorker.prototype, "onFailed", null);
__decorate([
    (0, bull_1.OnQueueCompleted)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], FacturacionWorker.prototype, "onCompleted", null);
exports.FacturacionWorker = FacturacionWorker = FacturacionWorker_1 = __decorate([
    (0, bull_1.Processor)(workers_constants_1.QUEUES.FACTURACION),
    __param(4, (0, typeorm_1.InjectDataSource)()),
    __metadata("design:paramtypes", [facturacion_service_1.FacturacionService,
        whatsapp_service_1.WhatsAppService,
        auditoria_service_1.AuditoriaService, typeof (_a = typeof event_emitter_1.EventEmitter !== "undefined" && event_emitter_1.EventEmitter) === "function" ? _a : Object, typeorm_2.DataSource])
], FacturacionWorker);
//# sourceMappingURL=facturacion.worker.js.map