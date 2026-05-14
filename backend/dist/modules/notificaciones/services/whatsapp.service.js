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
var WhatsAppService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppService = exports.TipoNotificacion = void 0;
const common_1 = require("@nestjs/common");
const axios_1 = require("@nestjs/axios");
const config_1 = require("@nestjs/config");
const rxjs_1 = require("rxjs");
var TipoNotificacion;
(function (TipoNotificacion) {
    TipoNotificacion["SERVICIO_ACTIVADO"] = "servicio_activado";
    TipoNotificacion["SERVICIO_SUSPENDIDO"] = "servicio_suspendido";
    TipoNotificacion["SERVICIO_REACTIVADO"] = "servicio_reactivado";
    TipoNotificacion["FACTURA_EMITIDA"] = "factura_emitida";
    TipoNotificacion["PAGO_RECIBIDO"] = "pago_recibido";
    TipoNotificacion["PAGO_VENCE_HOY"] = "pago_vence_hoy";
    TipoNotificacion["PAGO_VENCIDO"] = "pago_vencido";
    TipoNotificacion["PRORROGA_CONCEDIDA"] = "prorroga_concedida";
    TipoNotificacion["BIENVENIDA"] = "bienvenida";
    TipoNotificacion["ONU_OFFLINE"] = "onu_offline";
    TipoNotificacion["MANTENIMIENTO"] = "mantenimiento";
})(TipoNotificacion || (exports.TipoNotificacion = TipoNotificacion = {}));
const TEMPLATES = {
    [TipoNotificacion.BIENVENIDA]: {
        name: 'fibranet_bienvenida',
        language: 'es',
        paramKeys: ['clienteNombre', 'planNombre', 'velocidadBajada', 'velocidadSubida', 'usuarioPppoe'],
    },
    [TipoNotificacion.SERVICIO_ACTIVADO]: {
        name: 'fibranet_servicio_activado',
        language: 'es',
        paramKeys: ['clienteNombre', 'planNombre', 'ipAsignada', 'usuarioPppoe'],
    },
    [TipoNotificacion.SERVICIO_SUSPENDIDO]: {
        name: 'fibranet_servicio_suspendido',
        language: 'es',
        paramKeys: ['clienteNombre', 'deudaTotal', 'numeroCuenta', 'nombreEmpresa'],
    },
    [TipoNotificacion.SERVICIO_REACTIVADO]: {
        name: 'fibranet_servicio_reactivado',
        language: 'es',
        paramKeys: ['clienteNombre', 'planNombre'],
    },
    [TipoNotificacion.FACTURA_EMITIDA]: {
        name: 'fibranet_factura_emitida',
        language: 'es',
        paramKeys: ['clienteNombre', 'numeroFactura', 'montoTotal', 'fechaVencimiento'],
    },
    [TipoNotificacion.PAGO_RECIBIDO]: {
        name: 'fibranet_pago_recibido',
        language: 'es',
        paramKeys: ['clienteNombre', 'montoPago', 'metodoPago', 'saldoPendiente'],
    },
    [TipoNotificacion.PAGO_VENCE_HOY]: {
        name: 'fibranet_pago_vence_hoy',
        language: 'es',
        paramKeys: ['clienteNombre', 'montoDeuda', 'linkPago'],
    },
    [TipoNotificacion.PAGO_VENCIDO]: {
        name: 'fibranet_pago_vencido',
        language: 'es',
        paramKeys: ['clienteNombre', 'montoDeuda', 'diasVencido', 'numeroCuenta'],
    },
    [TipoNotificacion.PRORROGA_CONCEDIDA]: {
        name: 'fibranet_prorroga',
        language: 'es',
        paramKeys: ['clienteNombre', 'fechaProrroga', 'montoDeuda'],
    },
    [TipoNotificacion.ONU_OFFLINE]: {
        name: 'fibranet_onu_offline',
        language: 'es',
        paramKeys: ['clienteNombre', 'fechaHora'],
    },
    [TipoNotificacion.MANTENIMIENTO]: {
        name: 'fibranet_mantenimiento',
        language: 'es',
        paramKeys: ['clienteNombre', 'fechaInicio', 'duracionEstimada', 'motivo'],
    },
};
let WhatsAppService = WhatsAppService_1 = class WhatsAppService {
    constructor(http, config) {
        this.http = http;
        this.config = config;
        this.logger = new common_1.Logger(WhatsAppService_1.name);
        this.token = config.get('app.whatsapp.token', '');
        this.phoneId = config.get('app.whatsapp.phoneId', '');
        this.apiUrl = `https://graph.facebook.com/v18.0/${this.phoneId}/messages`;
        this.enabled = !!this.token && !!this.phoneId;
    }
    async enviar(params) {
        if (!this.enabled) {
            this.logger.warn('WhatsApp no configurado — notificación omitida');
            return { enviado: false, error: 'WhatsApp no configurado' };
        }
        const template = TEMPLATES[params.tipo];
        if (!template) {
            this.logger.warn(`Template no encontrado: ${params.tipo}`);
            return { enviado: false, error: `Template desconocido: ${params.tipo}` };
        }
        const telefono = this.normalizarTelefono(params.telefono);
        if (!telefono) {
            return { enviado: false, error: `Teléfono inválido: ${params.telefono}` };
        }
        const components = this.buildComponents(template.paramKeys, params.variables);
        const body = {
            messaging_product: 'whatsapp',
            to: telefono,
            type: 'template',
            template: {
                name: template.name,
                language: { code: template.language },
                components,
            },
        };
        try {
            const res = await (0, rxjs_1.firstValueFrom)(this.http.post(this.apiUrl, body, {
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    'Content-Type': 'application/json',
                },
                timeout: 15_000,
            }));
            const messageId = res.data?.messages?.[0]?.id;
            this.logger.log(`WhatsApp enviado: ${params.tipo} → ${telefono} | msgId: ${messageId}`);
            return { enviado: true, messageId };
        }
        catch (error) {
            const errMsg = error?.response?.data?.error?.message || error.message;
            this.logger.error(`WhatsApp error → ${telefono} | ${params.tipo}: ${errMsg}`);
            return { enviado: false, error: errMsg };
        }
    }
    async notificarServicioActivado(params) {
        return this.enviar({
            telefono: params.telefono,
            tipo: TipoNotificacion.SERVICIO_ACTIVADO,
            variables: {
                clienteNombre: params.clienteNombre,
                planNombre: params.planNombre,
                ipAsignada: params.ipAsignada,
                usuarioPppoe: params.usuarioPppoe,
            },
            empresaId: params.empresaId,
            clienteId: params.clienteId,
        });
    }
    async notificarServicioSuspendido(params) {
        return this.enviar({
            telefono: params.telefono,
            tipo: TipoNotificacion.SERVICIO_SUSPENDIDO,
            variables: {
                clienteNombre: params.clienteNombre,
                deudaTotal: `S/ ${params.deudaTotal.toFixed(2)}`,
                numeroCuenta: params.numeroCuenta || 'ver al asesor',
                nombreEmpresa: params.nombreEmpresa || 'FibraNet ISP',
            },
            empresaId: params.empresaId,
            clienteId: params.clienteId,
        });
    }
    async notificarServicioReactivado(params) {
        return this.enviar({
            telefono: params.telefono,
            tipo: TipoNotificacion.SERVICIO_REACTIVADO,
            variables: {
                clienteNombre: params.clienteNombre,
                planNombre: params.planNombre,
            },
            empresaId: params.empresaId,
            clienteId: params.clienteId,
        });
    }
    async notificarFacturaEmitida(params) {
        return this.enviar({
            telefono: params.telefono,
            tipo: TipoNotificacion.FACTURA_EMITIDA,
            variables: {
                clienteNombre: params.clienteNombre,
                numeroFactura: params.numeroFactura,
                montoTotal: `S/ ${params.montoTotal.toFixed(2)}`,
                fechaVencimiento: params.fechaVencimiento,
            },
            empresaId: params.empresaId,
            clienteId: params.clienteId,
        });
    }
    async notificarPagoRecibido(params) {
        return this.enviar({
            telefono: params.telefono,
            tipo: TipoNotificacion.PAGO_RECIBIDO,
            variables: {
                clienteNombre: params.clienteNombre,
                montoPago: `S/ ${params.montoPago.toFixed(2)}`,
                metodoPago: params.metodoPago,
                saldoPendiente: `S/ ${params.saldoPendiente.toFixed(2)}`,
            },
            empresaId: params.empresaId,
            clienteId: params.clienteId,
        });
    }
    async notificarBienvenida(params) {
        return this.enviar({
            telefono: params.telefono,
            tipo: TipoNotificacion.BIENVENIDA,
            variables: {
                clienteNombre: params.clienteNombre,
                planNombre: params.planNombre,
                velocidadBajada: `${params.velocidadBajada} Mbps`,
                velocidadSubida: `${params.velocidadSubida} Mbps`,
                usuarioPppoe: params.usuarioPppoe,
            },
            empresaId: params.empresaId,
            clienteId: params.clienteId,
        });
    }
    async enviarMasivo(mensajes, delayMs = 200) {
        let exitosos = 0;
        let fallidos = 0;
        for (const msg of mensajes) {
            const r = await this.enviar(msg);
            r.enviado ? exitosos++ : fallidos++;
            if (delayMs > 0 && mensajes.indexOf(msg) < mensajes.length - 1) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
        this.logger.log(`WhatsApp masivo: ${exitosos} enviados, ${fallidos} fallidos`);
        return { exitosos, fallidos };
    }
    buildComponents(paramKeys, variables) {
        if (!paramKeys.length)
            return [];
        const parameters = paramKeys.map((key) => ({
            type: 'text',
            text: variables[key] || '',
        }));
        return [{
                type: 'body',
                parameters,
            }];
    }
    normalizarTelefono(tel) {
        if (!tel)
            return null;
        const clean = tel.replace(/[^\d+]/g, '');
        if (clean.startsWith('+'))
            return clean.replace('+', '');
        if (clean.startsWith('51'))
            return clean;
        if (clean.startsWith('9') && clean.length === 9) {
            return `51${clean}`;
        }
        if (clean.length === 9)
            return `51${clean}`;
        if (clean.length >= 11)
            return clean;
        return null;
    }
};
exports.WhatsAppService = WhatsAppService;
exports.WhatsAppService = WhatsAppService = WhatsAppService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [axios_1.HttpService,
        config_1.ConfigService])
], WhatsAppService);
//# sourceMappingURL=whatsapp.service.js.map