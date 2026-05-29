import {
  Injectable, Logger, Inject,
} from '@nestjs/common';
import { HttpService }    from '@nestjs/axios';
import { ConfigService }  from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource }       from 'typeorm';
import { CACHE_MANAGER }    from '@nestjs/cache-manager';
import { Cache }            from 'cache-manager';
import { decrypt }          from '../../../common/utils/encryption.util';

// ─── Tipos de notificación ────────────────────────────────────
export enum TipoNotificacion {
  SERVICIO_ACTIVADO    = 'servicio_activado',
  SERVICIO_SUSPENDIDO  = 'servicio_suspendido',
  SERVICIO_REACTIVADO  = 'servicio_reactivado',
  FACTURA_EMITIDA      = 'factura_emitida',
  PAGO_RECIBIDO        = 'pago_recibido',
  PAGO_VENCE_HOY       = 'pago_vence_hoy',
  PAGO_VENCIDO         = 'pago_vencido',
  PRORROGA_CONCEDIDA   = 'prorroga_concedida',
  BIENVENIDA           = 'bienvenida',
  ONU_OFFLINE          = 'onu_offline',
  MANTENIMIENTO        = 'mantenimiento',
}

export interface WhatsAppParams {
  telefono:    string;
  tipo:        TipoNotificacion;
  variables:   Record<string, string>;
  empresaId?:  string;
  clienteId?:  string;
}

// ─── Configuración resuelta por empresa ───────────────────────
interface WaConfig {
  token:   string;
  phoneId: string;
  apiUrl:  string;
}

const TEMPLATES: Record<TipoNotificacion, {
  name:      string;
  language:  string;
  paramKeys: string[];
}> = {
  [TipoNotificacion.BIENVENIDA]: {
    name:      'datafast_bienvenida',
    language:  'es',
    paramKeys: ['clienteNombre', 'planNombre', 'velocidadBajada', 'velocidadSubida', 'usuarioPppoe'],
  },
  [TipoNotificacion.SERVICIO_ACTIVADO]: {
    name:      'datafast_servicio_activado',
    language:  'es',
    paramKeys: ['clienteNombre', 'planNombre', 'ipAsignada', 'usuarioPppoe'],
  },
  [TipoNotificacion.SERVICIO_SUSPENDIDO]: {
    name:      'datafast_servicio_suspendido',
    language:  'es',
    paramKeys: ['clienteNombre', 'deudaTotal', 'numeroCuenta', 'nombreEmpresa'],
  },
  [TipoNotificacion.SERVICIO_REACTIVADO]: {
    name:      'datafast_servicio_reactivado',
    language:  'es',
    paramKeys: ['clienteNombre', 'planNombre'],
  },
  [TipoNotificacion.FACTURA_EMITIDA]: {
    name:      'datafast_factura_emitida',
    language:  'es',
    paramKeys: ['clienteNombre', 'numeroFactura', 'montoTotal', 'fechaVencimiento'],
  },
  [TipoNotificacion.PAGO_RECIBIDO]: {
    name:      'datafast_pago_recibido',
    language:  'es',
    paramKeys: ['clienteNombre', 'montoPago', 'metodoPago', 'saldoPendiente'],
  },
  [TipoNotificacion.PAGO_VENCE_HOY]: {
    name:      'datafast_pago_vence_hoy',
    language:  'es',
    paramKeys: ['clienteNombre', 'montoDeuda', 'linkPago'],
  },
  [TipoNotificacion.PAGO_VENCIDO]: {
    name:      'datafast_pago_vencido',
    language:  'es',
    paramKeys: ['clienteNombre', 'montoDeuda', 'diasVencido', 'numeroCuenta'],
  },
  [TipoNotificacion.PRORROGA_CONCEDIDA]: {
    name:      'datafast_prorroga',
    language:  'es',
    paramKeys: ['clienteNombre', 'fechaProrroga', 'montoDeuda'],
  },
  [TipoNotificacion.ONU_OFFLINE]: {
    name:      'datafast_onu_offline',
    language:  'es',
    paramKeys: ['clienteNombre', 'fechaHora'],
  },
  [TipoNotificacion.MANTENIMIENTO]: {
    name:      'datafast_mantenimiento',
    language:  'es',
    paramKeys: ['clienteNombre', 'fechaInicio', 'duracionEstimada', 'motivo'],
  },
};

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  // Fallback de env vars para empresas sin config en BD
  private readonly envToken:   string;
  private readonly envPhoneId: string;

  constructor(
    private readonly http:    HttpService,
    private readonly config:  ConfigService,
    @InjectDataSource() private readonly ds:    DataSource,
    @Inject(CACHE_MANAGER)  private readonly cache: Cache,
  ) {
    this.envToken   = config.get<string>('app.whatsapp.token',   '');
    this.envPhoneId = config.get<string>('app.whatsapp.phoneId', '');
  }

  // ────────────────────────────────────────────────────────────
  // ENVIAR NOTIFICACIÓN POR TEMPLATE
  // ────────────────────────────────────────────────────────────
  async enviar(params: WhatsAppParams): Promise<{ enviado: boolean; messageId?: string; error?: string }> {
    const waConf = await this.resolveConfig(params.empresaId);
    if (!waConf) {
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

    const body = {
      messaging_product: 'whatsapp',
      to:                telefono,
      type:              'template',
      template: {
        name:       template.name,
        language:   { code: template.language },
        components: this.buildComponents(template.paramKeys, params.variables),
      },
    };

    try {
      const res = await firstValueFrom(
        this.http.post(waConf.apiUrl, body, {
          headers: {
            Authorization:  `Bearer ${waConf.token}`,
            'Content-Type': 'application/json',
          },
          timeout: 15_000,
        }),
      );

      const messageId = res.data?.messages?.[0]?.id;
      this.logger.log(`WhatsApp enviado: ${params.tipo} → ${telefono} | msgId: ${messageId}`);
      return { enviado: true, messageId };

    } catch (error) {
      const errMsg = error?.response?.data?.error?.message || error.message;
      this.logger.error(`WhatsApp error → ${telefono} | ${params.tipo}: ${errMsg}`);
      return { enviado: false, error: errMsg };
    }
  }

  // ────────────────────────────────────────────────────────────
  // SHORTCUTS POR TIPO DE EVENTO
  // ────────────────────────────────────────────────────────────

  async notificarServicioActivado(params: {
    telefono: string; clienteNombre: string; planNombre: string;
    ipAsignada: string; usuarioPppoe: string; empresaId?: string; clienteId?: string;
  }) {
    return this.enviar({
      telefono: params.telefono, tipo: TipoNotificacion.SERVICIO_ACTIVADO,
      variables: {
        clienteNombre: params.clienteNombre, planNombre: params.planNombre,
        ipAsignada: params.ipAsignada, usuarioPppoe: params.usuarioPppoe,
      },
      empresaId: params.empresaId, clienteId: params.clienteId,
    });
  }

  async notificarServicioSuspendido(params: {
    telefono: string; clienteNombre: string; deudaTotal: number;
    numeroCuenta?: string; nombreEmpresa?: string; empresaId?: string; clienteId?: string;
  }) {
    return this.enviar({
      telefono: params.telefono, tipo: TipoNotificacion.SERVICIO_SUSPENDIDO,
      variables: {
        clienteNombre: params.clienteNombre,
        deudaTotal:    `S/ ${params.deudaTotal.toFixed(2)}`,
        numeroCuenta:  params.numeroCuenta || 'ver al asesor',
        nombreEmpresa: params.nombreEmpresa || 'CRM ISP DATAFAST',
      },
      empresaId: params.empresaId, clienteId: params.clienteId,
    });
  }

  async notificarServicioReactivado(params: {
    telefono: string; clienteNombre: string; planNombre: string;
    empresaId?: string; clienteId?: string;
  }) {
    return this.enviar({
      telefono: params.telefono, tipo: TipoNotificacion.SERVICIO_REACTIVADO,
      variables: { clienteNombre: params.clienteNombre, planNombre: params.planNombre },
      empresaId: params.empresaId, clienteId: params.clienteId,
    });
  }

  async notificarFacturaEmitida(params: {
    telefono: string; clienteNombre: string; numeroFactura: string;
    montoTotal: number; fechaVencimiento: string; empresaId?: string; clienteId?: string;
  }) {
    return this.enviar({
      telefono: params.telefono, tipo: TipoNotificacion.FACTURA_EMITIDA,
      variables: {
        clienteNombre:    params.clienteNombre,
        numeroFactura:    params.numeroFactura,
        montoTotal:       `S/ ${params.montoTotal.toFixed(2)}`,
        fechaVencimiento: params.fechaVencimiento,
      },
      empresaId: params.empresaId, clienteId: params.clienteId,
    });
  }

  async notificarPagoRecibido(params: {
    telefono: string; clienteNombre: string; montoPago: number;
    metodoPago: string; saldoPendiente: number; empresaId?: string; clienteId?: string;
  }) {
    return this.enviar({
      telefono: params.telefono, tipo: TipoNotificacion.PAGO_RECIBIDO,
      variables: {
        clienteNombre:  params.clienteNombre,
        montoPago:      `S/ ${params.montoPago.toFixed(2)}`,
        metodoPago:     params.metodoPago,
        saldoPendiente: `S/ ${params.saldoPendiente.toFixed(2)}`,
      },
      empresaId: params.empresaId, clienteId: params.clienteId,
    });
  }

  async notificarBienvenida(params: {
    telefono: string; clienteNombre: string; planNombre: string;
    velocidadBajada: number; velocidadSubida: number; usuarioPppoe: string;
    empresaId?: string; clienteId?: string;
  }) {
    return this.enviar({
      telefono: params.telefono, tipo: TipoNotificacion.BIENVENIDA,
      variables: {
        clienteNombre:   params.clienteNombre,
        planNombre:      params.planNombre,
        velocidadBajada: `${params.velocidadBajada} Mbps`,
        velocidadSubida: `${params.velocidadSubida} Mbps`,
        usuarioPppoe:    params.usuarioPppoe,
      },
      empresaId: params.empresaId, clienteId: params.clienteId,
    });
  }

  // ────────────────────────────────────────────────────────────
  // ENVÍO MASIVO
  // ────────────────────────────────────────────────────────────
  async enviarMasivo(
    mensajes: WhatsAppParams[],
    delayMs = 200,
  ): Promise<{ exitosos: number; fallidos: number }> {
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

  // ────────────────────────────────────────────────────────────
  // RESOLUCIÓN DINÁMICA DE CONFIG POR EMPRESA
  // Prioridad: BD (por empresaId) → env vars (fallback global)
  // El token cifrado se descifra en memoria justo antes del envío.
  // ────────────────────────────────────────────────────────────
  private async resolveConfig(empresaId?: string): Promise<WaConfig | null> {
    // Intentar config de la empresa en BD
    if (empresaId) {
      const cacheKey = `wa:config:${empresaId}`;
      let cached = await this.cache.get<{ encryptedToken: string; phoneId: string } | null>(cacheKey);

      if (cached === undefined) {
        const [row] = await this.ds.query(
          `SELECT whatsapp_token AS encrypted_token, whatsapp_phone_id AS phone_id
           FROM empresas WHERE id = $1`,
          [empresaId],
        ).catch(() => [null]);

        if (row?.phone_id && row?.encrypted_token) {
          cached = { encryptedToken: row.encrypted_token, phoneId: row.phone_id };
        } else {
          cached = null;
        }
        // Cache 5 min — null también se cachea para evitar queries repetidas
        await this.cache.set(cacheKey, cached, 5 * 60 * 1000);
      }

      if (cached) {
        try {
          const token = decrypt(cached.encryptedToken);
          return {
            token,
            phoneId: cached.phoneId,
            apiUrl:  `https://graph.facebook.com/v18.0/${cached.phoneId}/messages`,
          };
        } catch (err) {
          this.logger.error(`[WA] Error descifrando token de empresa ${empresaId}: ${err.message}`);
        }
      }
    }

    // Fallback: env vars
    if (this.envToken && this.envPhoneId) {
      return {
        token:   this.envToken,
        phoneId: this.envPhoneId,
        apiUrl:  `https://graph.facebook.com/v18.0/${this.envPhoneId}/messages`,
      };
    }

    return null;
  }

  // ────────────────────────────────────────────────────────────
  // HELPERS PRIVADOS
  // ────────────────────────────────────────────────────────────

  private buildComponents(paramKeys: string[], variables: Record<string, string>): any[] {
    if (!paramKeys.length) return [];
    return [{
      type:       'body',
      parameters: paramKeys.map((key) => ({ type: 'text', text: variables[key] || '' })),
    }];
  }

  private normalizarTelefono(tel: string): string | null {
    if (!tel) return null;
    const clean = tel.replace(/[^\d+]/g, '');
    if (clean.startsWith('+')) return clean.replace('+', '');
    if (clean.startsWith('51')) return clean;
    if (clean.startsWith('9') && clean.length === 9) return `51${clean}`;
    if (clean.length === 9) return `51${clean}`;
    if (clean.length >= 11) return clean;
    return null;
  }
}
