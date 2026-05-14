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
var MercadoPagoService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MercadoPagoService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const axios_1 = require("@nestjs/axios");
const rxjs_1 = require("rxjs");
const crypto = require("crypto");
let MercadoPagoService = MercadoPagoService_1 = class MercadoPagoService {
    constructor(config, http) {
        this.config = config;
        this.http = http;
        this.logger = new common_1.Logger(MercadoPagoService_1.name);
        this.baseUrl = 'https://api.mercadopago.com';
        this.accessToken = config.get('app.mp.accessToken', '');
        this.webhookSecret = config.get('app.mp.webhookSecret', '');
    }
    async crearPreferencia(params) {
        if (!this.accessToken) {
            throw new common_1.BadRequestException('MercadoPago no está configurado en el servidor');
        }
        const body = {
            items: [{
                    id: params.facturaId,
                    title: params.titulo,
                    description: params.descripcion,
                    quantity: 1,
                    unit_price: Number(params.monto),
                    currency_id: 'PEN',
                }],
            payer: {
                email: params.clienteEmail,
            },
            external_reference: params.facturaId,
            back_urls: {
                success: params.urlExito || `${this.config.get('app.frontendUrl')}/pagos/exitoso`,
                failure: params.urlFallo || `${this.config.get('app.frontendUrl')}/pagos/fallido`,
                pending: params.urlPendiente || `${this.config.get('app.frontendUrl')}/pagos/pendiente`,
            },
            auto_return: 'approved',
            notification_url: `${this.config.get('app.url')}/api/v1/pagos/webhooks/mercadopago`,
            statement_descriptor: 'FibraNet ISP',
            metadata: {
                factura_id: params.facturaId,
                sistema: 'fibranet-isp',
            },
        };
        try {
            const response = await (0, rxjs_1.firstValueFrom)(this.http.post(`${this.baseUrl}/checkout/preferences`, body, {
                headers: this.getHeaders(),
            }));
            this.logger.log(`Preferencia MP creada: ${response.data.id} | factura: ${params.facturaId}`);
            return {
                id: response.data.id,
                init_point: response.data.init_point,
                sandbox_init_point: response.data.sandbox_init_point,
            };
        }
        catch (error) {
            const detail = error?.response?.data || error.message;
            this.logger.error(`Error creando preferencia MP: ${JSON.stringify(detail)}`);
            throw new common_1.BadRequestException(`Error al crear preferencia de pago: ${detail?.message || error.message}`);
        }
    }
    async consultarPago(paymentId) {
        if (!this.accessToken) {
            throw new common_1.BadRequestException('MercadoPago no configurado');
        }
        try {
            const response = await (0, rxjs_1.firstValueFrom)(this.http.get(`${this.baseUrl}/v1/payments/${paymentId}`, {
                headers: this.getHeaders(),
            }));
            return response.data;
        }
        catch (error) {
            const detail = error?.response?.data;
            this.logger.error(`Error consultando pago MP ${paymentId}: ${JSON.stringify(detail)}`);
            throw new common_1.BadRequestException(`No se pudo consultar el pago en MercadoPago: ${error.message}`);
        }
    }
    validarWebhookSignature(rawBody, xSignature, xRequestId) {
        if (!this.webhookSecret) {
            this.logger.warn('WEBHOOK_SECRET de MercadoPago no configurado — omitiendo validación');
            return true;
        }
        try {
            const parts = Object.fromEntries(xSignature.split(',').map(p => p.split('=')));
            const ts = parts['ts'];
            const v1 = parts['v1'];
            if (!ts || !v1)
                return false;
            const manifest = `id:${xRequestId};request-id:${xRequestId};ts:${ts};`;
            const expectedHash = crypto
                .createHmac('sha256', this.webhookSecret)
                .update(manifest)
                .digest('hex');
            const isValid = crypto.timingSafeEqual(Buffer.from(expectedHash, 'hex'), Buffer.from(v1, 'hex'));
            if (!isValid) {
                this.logger.warn(`Firma webhook MP inválida. Expected: ${expectedHash} | Got: ${v1}`);
            }
            return isValid;
        }
        catch (err) {
            this.logger.error(`Error validando firma webhook MP: ${err.message}`);
            return false;
        }
    }
    esAprobado(payment) {
        return payment.status === 'approved';
    }
    esPendiente(payment) {
        return payment.status === 'pending' || payment.status === 'in_process';
    }
    getHeaders() {
        return {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
            'X-Idempotency-Key': crypto.randomUUID(),
        };
    }
};
exports.MercadoPagoService = MercadoPagoService;
exports.MercadoPagoService = MercadoPagoService = MercadoPagoService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        axios_1.HttpService])
], MercadoPagoService);
//# sourceMappingURL=mercadopago.service.js.map