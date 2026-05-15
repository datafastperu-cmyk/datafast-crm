import {
  Injectable, Logger,
} from '@nestjs/common';
import { HttpService }    from '@nestjs/axios';
import { ConfigService }  from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

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
  telefono:     string;    // +51987654321
  tipo:         TipoNotificacion;
  variables:    Record<string, string>; // variables del template
  empresaId?:   string;
  clienteId?:   string;
}

// ─── Templates para cada tipo de notificación ─────────────────
// Los templates deben estar aprobados en Meta Business Manager.
// Formato: nombre_template → { templateName, languageCode, components }
const TEMPLATES: Record<TipoNotificacion, {
  name:     string;
  language: string;
  // Orden de variables {{1}}, {{2}}, ... según el template aprobado
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

  private readonly apiUrl:   string;
  private readonly token:    string;
  private readonly phoneId:  string;    // ID del número en Meta
  private readonly enabled:  boolean;

  constructor(
    private readonly http:   HttpService,
    private readonly config: ConfigService,
  ) {
    this.token    = config.get<string>('app.whatsapp.token', '');
    this.phoneId  = config.get<string>('app.whatsapp.phoneId', '');
    this.apiUrl   = `https://graph.facebook.com/v18.0/${this.phoneId}/messages`;
    this.enabled  = !!this.token && !!this.phoneId;
  }

  // ────────────────────────────────────────────────────────────
  // ENVIAR NOTIFICACIÓN POR TEMPLATE
  // ────────────────────────────────────────────────────────────
  async enviar(params: WhatsAppParams): Promise<{ enviado: boolean; messageId?: string; error?: string }> {
    if (!this.enabled) {
      this.logger.warn('WhatsApp no configurado — notificación omitida');
      return { enviado: false, error: 'WhatsApp no configurado' };
    }

    const template = TEMPLATES[params.tipo];
    if (!template) {
      this.logger.warn(`Template no encontrado: ${params.tipo}`);
      return { enviado: false, error: `Template desconocido: ${params.tipo}` };
    }

    // Normalizar teléfono: quitar espacios, guiones, agregar código de país
    const telefono = this.normalizarTelefono(params.telefono);
    if (!telefono) {
      return { enviado: false, error: `Teléfono inválido: ${params.telefono}` };
    }

    // Construir parámetros del template en orden
    const components = this.buildComponents(template.paramKeys, params.variables);

    const body = {
      messaging_product: 'whatsapp',
      to:                telefono,
      type:              'template',
      template: {
        name:     template.name,
        language: { code: template.language },
        components,
      },
    };

    try {
      const res = await firstValueFrom(
        this.http.post(this.apiUrl, body, {
          headers: {
            Authorization:  `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
          timeout: 15_000,
        }),
      );

      const messageId = res.data?.messages?.[0]?.id;
      this.logger.log(
        `WhatsApp enviado: ${params.tipo} → ${telefono} | msgId: ${messageId}`,
      );

      return { enviado: true, messageId };

    } catch (error) {
      const errMsg = error?.response?.data?.error?.message || error.message;
      this.logger.error(`WhatsApp error → ${telefono} | ${params.tipo}: ${errMsg}`);
      // No lanzar excepción — las notificaciones no deben interrumpir el flujo
      return { enviado: false, error: errMsg };
    }
  }

  // ────────────────────────────────────────────────────────────
  // SHORTCUTS POR TIPO DE EVENTO
  // ────────────────────────────────────────────────────────────

  async notificarServicioActivado(params: {
    telefono:       string;
    clienteNombre:  string;
    planNombre:     string;
    ipAsignada:     string;
    usuarioPppoe:   string;
    empresaId?:     string;
    clienteId?:     string;
  }) {
    return this.enviar({
      telefono:  params.telefono,
      tipo:      TipoNotificacion.SERVICIO_ACTIVADO,
      variables: {
        clienteNombre: params.clienteNombre,
        planNombre:    params.planNombre,
        ipAsignada:    params.ipAsignada,
        usuarioPppoe:  params.usuarioPppoe,
      },
      empresaId: params.empresaId,
      clienteId: params.clienteId,
    });
  }

  async notificarServicioSuspendido(params: {
    telefono:      string;
    clienteNombre: string;
    deudaTotal:    number;
    numeroCuenta?: string;
    nombreEmpresa?: string;
    empresaId?:    string;
    clienteId?:    string;
  }) {
    return this.enviar({
      telefono:  params.telefono,
      tipo:      TipoNotificacion.SERVICIO_SUSPENDIDO,
      variables: {
        clienteNombre: params.clienteNombre,
        deudaTotal:    `S/ ${params.deudaTotal.toFixed(2)}`,
        numeroCuenta:  params.numeroCuenta || 'ver al asesor',
        nombreEmpresa: params.nombreEmpresa || 'CRM ISP DATAFAST',
      },
      empresaId: params.empresaId,
      clienteId: params.clienteId,
    });
  }

  async notificarServicioReactivado(params: {
    telefono:      string;
    clienteNombre: string;
    planNombre:    string;
    empresaId?:    string;
    clienteId?:    string;
  }) {
    return this.enviar({
      telefono:  params.telefono,
      tipo:      TipoNotificacion.SERVICIO_REACTIVADO,
      variables: {
        clienteNombre: params.clienteNombre,
        planNombre:    params.planNombre,
      },
      empresaId: params.empresaId,
      clienteId: params.clienteId,
    });
  }

  async notificarFacturaEmitida(params: {
    telefono:        string;
    clienteNombre:   string;
    numeroFactura:   string;
    montoTotal:      number;
    fechaVencimiento: string;
    empresaId?:      string;
    clienteId?:      string;
  }) {
    return this.enviar({
      telefono:  params.telefono,
      tipo:      TipoNotificacion.FACTURA_EMITIDA,
      variables: {
        clienteNombre:    params.clienteNombre,
        numeroFactura:    params.numeroFactura,
        montoTotal:       `S/ ${params.montoTotal.toFixed(2)}`,
        fechaVencimiento: params.fechaVencimiento,
      },
      empresaId: params.empresaId,
      clienteId: params.clienteId,
    });
  }

  async notificarPagoRecibido(params: {
    telefono:       string;
    clienteNombre:  string;
    montoPago:      number;
    metodoPago:     string;
    saldoPendiente: number;
    empresaId?:     string;
    clienteId?:     string;
  }) {
    return this.enviar({
      telefono:  params.telefono,
      tipo:      TipoNotificacion.PAGO_RECIBIDO,
      variables: {
        clienteNombre:  params.clienteNombre,
        montoPago:      `S/ ${params.montoPago.toFixed(2)}`,
        metodoPago:     params.metodoPago,
        saldoPendiente: `S/ ${params.saldoPendiente.toFixed(2)}`,
      },
      empresaId: params.empresaId,
      clienteId: params.clienteId,
    });
  }

  async notificarBienvenida(params: {
    telefono:       string;
    clienteNombre:  string;
    planNombre:     string;
    velocidadBajada: number;
    velocidadSubida: number;
    usuarioPppoe:   string;
    empresaId?:     string;
    clienteId?:     string;
  }) {
    return this.enviar({
      telefono:  params.telefono,
      tipo:      TipoNotificacion.BIENVENIDA,
      variables: {
        clienteNombre:   params.clienteNombre,
        planNombre:      params.planNombre,
        velocidadBajada: `${params.velocidadBajada} Mbps`,
        velocidadSubida: `${params.velocidadSubida} Mbps`,
        usuarioPppoe:    params.usuarioPppoe,
      },
      empresaId: params.empresaId,
      clienteId: params.clienteId,
    });
  }

  // ────────────────────────────────────────────────────────────
  // ENVÍO MASIVO (para cobranza mensual)
  // ────────────────────────────────────────────────────────────
  async enviarMasivo(
    mensajes: WhatsAppParams[],
    delayMs = 200,  // Meta limita ~80 msg/seg
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
  // HELPERS PRIVADOS
  // ────────────────────────────────────────────────────────────

  // Construir array de components para la API de Meta
  private buildComponents(
    paramKeys: string[],
    variables: Record<string, string>,
  ): any[] {
    if (!paramKeys.length) return [];

    const parameters = paramKeys.map((key) => ({
      type: 'text',
      text: variables[key] || '',
    }));

    return [{
      type:       'body',
      parameters,
    }];
  }

  // Normalizar teléfono peruano: '987654321' → '51987654321'
  private normalizarTelefono(tel: string): string | null {
    if (!tel) return null;

    // Quitar todo excepto dígitos y '+'
    const clean = tel.replace(/[^\d+]/g, '');

    // Si ya tiene código de país
    if (clean.startsWith('+')) return clean.replace('+', '');
    if (clean.startsWith('51')) return clean;

    // Agregar código Perú si empieza con 9 (celular)
    if (clean.startsWith('9') && clean.length === 9) {
      return `51${clean}`;
    }

    // Si tiene 8 dígitos (fijo), agregar código Perú
    if (clean.length === 9) return `51${clean}`;

    // Número ya con código internacional sin +
    if (clean.length >= 11) return clean;

    return null;
  }
}
