import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';

// ─── Tipos de MercadoPago ────────────────────────────────────
export interface MpPreferencia {
  id:          string;
  init_point:  string;   // URL de pago producción
  sandbox_init_point: string; // URL sandbox
}

export interface MpPaymentDetail {
  id:               number;
  status:           string;  // 'approved' | 'pending' | 'rejected' | 'cancelled'
  status_detail:    string;
  transaction_amount: number;
  currency_id:      string;
  date_approved:    string;
  payer: {
    email:          string;
    first_name:     string;
    last_name:      string;
  };
  payment_method_id: string;
  payment_type_id:   string;
  external_reference?: string;  // Nuestro ID de factura
  metadata?:         Record<string, any>;
}

@Injectable()
export class MercadoPagoService {
  private readonly logger   = new Logger(MercadoPagoService.name);
  private readonly baseUrl  = 'https://api.mercadopago.com';
  private readonly accessToken: string;
  private readonly webhookSecret: string;

  constructor(
    private readonly config: ConfigService,
    private readonly http:   HttpService,
  ) {
    this.accessToken   = config.get<string>('app.mp.accessToken', '');
    this.webhookSecret = config.get<string>('app.mp.webhookSecret', '');
  }

  // ── Crear preferencia de pago ──────────────────────────────
  // Retorna una URL a la que redirigir al cliente para pagar.
  async crearPreferencia(params: {
    facturaId:   string;
    titulo:      string;
    descripcion: string;
    monto:       number;
    clienteEmail: string;
    urlExito?:   string;
    urlFallo?:   string;
    urlPendiente?: string;
  }): Promise<MpPreferencia> {
    if (!this.accessToken) {
      throw new BadRequestException('MercadoPago no está configurado en el servidor');
    }

    const body = {
      items: [{
        id:          params.facturaId,
        title:       params.titulo,
        description: params.descripcion,
        quantity:    1,
        unit_price:  Number(params.monto),
        currency_id: 'PEN',
      }],
      payer: {
        email: params.clienteEmail,
      },
      external_reference: params.facturaId, // Lo usamos para identificar la factura en el webhook
      back_urls: {
        success: params.urlExito     || `${this.config.get('app.frontendUrl')}/pagos/exitoso`,
        failure: params.urlFallo     || `${this.config.get('app.frontendUrl')}/pagos/fallido`,
        pending: params.urlPendiente || `${this.config.get('app.frontendUrl')}/pagos/pendiente`,
      },
      auto_return: 'approved',
      notification_url: `${this.config.get('app.url')}/api/v1/pagos/webhooks/mercadopago`,
      statement_descriptor: 'FibraNet ISP',
      metadata: {
        factura_id:  params.facturaId,
        sistema:     'fibranet-isp',
      },
    };

    try {
      const response = await firstValueFrom(
        this.http.post(`${this.baseUrl}/checkout/preferences`, body, {
          headers: this.getHeaders(),
        }),
      );

      this.logger.log(`Preferencia MP creada: ${response.data.id} | factura: ${params.facturaId}`);

      return {
        id:                   response.data.id,
        init_point:           response.data.init_point,
        sandbox_init_point:   response.data.sandbox_init_point,
      };
    } catch (error) {
      const detail = error?.response?.data || error.message;
      this.logger.error(`Error creando preferencia MP: ${JSON.stringify(detail)}`);
      throw new BadRequestException(`Error al crear preferencia de pago: ${detail?.message || error.message}`);
    }
  }

  // ── Consultar detalle de un pago ──────────────────────────
  async consultarPago(paymentId: string): Promise<MpPaymentDetail> {
    if (!this.accessToken) {
      throw new BadRequestException('MercadoPago no configurado');
    }

    try {
      const response = await firstValueFrom(
        this.http.get(`${this.baseUrl}/v1/payments/${paymentId}`, {
          headers: this.getHeaders(),
        }),
      );
      return response.data;
    } catch (error) {
      const detail = error?.response?.data;
      this.logger.error(`Error consultando pago MP ${paymentId}: ${JSON.stringify(detail)}`);
      throw new BadRequestException(`No se pudo consultar el pago en MercadoPago: ${error.message}`);
    }
  }

  // ── Validar firma del webhook ──────────────────────────────
  // MercadoPago envía una firma HMAC-SHA256 en el header x-signature
  // para verificar que el webhook viene de ellos.
  validarWebhookSignature(
    rawBody:   string | Buffer,
    xSignature: string,
    xRequestId: string,
  ): boolean {
    if (!this.webhookSecret) {
      this.logger.warn('WEBHOOK_SECRET de MercadoPago no configurado — omitiendo validación');
      return true; // En desarrollo sin secret, aceptar
    }

    try {
      // Formato: ts=<timestamp>,v1=<hash>
      const parts   = Object.fromEntries(xSignature.split(',').map(p => p.split('=')));
      const ts       = parts['ts'];
      const v1       = parts['v1'];

      if (!ts || !v1) return false;

      // El string a firmar: "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
      // Nota: el body.data.id viene del payload, pero aquí usamos el request-id y ts
      const manifest = `id:${xRequestId};request-id:${xRequestId};ts:${ts};`;

      const expectedHash = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(manifest)
        .digest('hex');

      const isValid = crypto.timingSafeEqual(
        Buffer.from(expectedHash, 'hex'),
        Buffer.from(v1, 'hex'),
      );

      if (!isValid) {
        this.logger.warn(`Firma webhook MP inválida. Expected: ${expectedHash} | Got: ${v1}`);
      }

      return isValid;
    } catch (err) {
      this.logger.error(`Error validando firma webhook MP: ${err.message}`);
      return false;
    }
  }

  // ── Determinar si un pago de MP fue aprobado ──────────────
  esAprobado(payment: MpPaymentDetail): boolean {
    return payment.status === 'approved';
  }

  esPendiente(payment: MpPaymentDetail): boolean {
    return payment.status === 'pending' || payment.status === 'in_process';
  }

  // ── Headers estándar para la API de MP ───────────────────
  private getHeaders() {
    return {
      Authorization:  `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': crypto.randomUUID(), // Prevenir duplicados en MP
    };
  }
}
