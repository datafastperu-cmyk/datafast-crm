import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { HttpService }    from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource }       from 'typeorm';
import { CACHE_MANAGER }    from '@nestjs/cache-manager';
import { Cache }            from 'cache-manager';
import { decrypt }          from '../../../common/utils/encryption.util';
import { WhatsAppService, TipoNotificacion, WhatsAppParams } from './whatsapp.service';
import { DatafastNativeStrategy }          from './datafast-native.strategy';
import { DatafastMensajeriaMasivaStrategy } from './datafast-mensajeria-masiva.strategy';

export type ProveedorActivo =
  | 'META_GRAPH'
  | 'TWILIO'
  | 'VONAGE'
  | 'CUSTOM_API'
  | 'AUTOMATIZADO_VIP'
  | 'DATAFAST_NATIVE'
  | 'DATAFAST_MENSAJERIA_MASIVA';

export interface EnvioResult {
  enviado:    boolean;
  messageId?: string;
  error?:     string;
}

// ─── Interfaz común para todas las estrategias ───────────
export interface IMensajeriaStrategy {
  enviarMensaje(
    telefono: string,
    texto:    string,
    template: string,
  ): Promise<EnvioResult>;
}

// ─── Textos renderizados para proveedores no-template ────
const TEXTOS: Record<string, (v: Record<string, string>) => string> = {
  [TipoNotificacion.PAGO_VENCE_HOY]:      (v) =>
    `Hola ${v.clienteNombre}, su pago de ${v.montoDeuda} vence hoy. ${v.linkPago || ''}`.trim(),
  [TipoNotificacion.PAGO_VENCIDO]:        (v) =>
    `Hola ${v.clienteNombre}, su deuda de ${v.montoDeuda} lleva ${v.diasVencido} días vencida. Cuenta: ${v.numeroCuenta}`,
  [TipoNotificacion.SERVICIO_SUSPENDIDO]: (v) =>
    `Hola ${v.clienteNombre}, servicio suspendido por deuda de ${v.deudaTotal}. ${v.nombreEmpresa}`,
  [TipoNotificacion.SERVICIO_REACTIVADO]: (v) =>
    `Hola ${v.clienteNombre}, su servicio ${v.planNombre} fue reactivado.`,
  [TipoNotificacion.SERVICIO_ACTIVADO]:   (v) =>
    `Bienvenido ${v.clienteNombre}. Plan ${v.planNombre} | IP: ${v.ipAsignada} | Usuario: ${v.usuarioPppoe}`,
  [TipoNotificacion.BIENVENIDA]:          (v) =>
    `Bienvenido ${v.clienteNombre}. Plan: ${v.planNombre} ${v.velocidadBajada}↓/${v.velocidadSubida}↑ | Usuario: ${v.usuarioPppoe}`,
  [TipoNotificacion.FACTURA_EMITIDA]:     (v) =>
    `Hola ${v.clienteNombre}, factura #${v.numeroFactura} por ${v.montoTotal}. Vence: ${v.fechaVencimiento}`,
  [TipoNotificacion.PAGO_RECIBIDO]:       (v) =>
    `Hola ${v.clienteNombre}, recibimos ${v.montoPago} vía ${v.metodoPago}. Saldo: ${v.saldoPendiente}`,
  [TipoNotificacion.PRORROGA_CONCEDIDA]:  (v) =>
    `Hola ${v.clienteNombre}, prórroga concedida hasta ${v.fechaProrroga}. Deuda: ${v.montoDeuda}`,
  [TipoNotificacion.ONU_OFFLINE]:         (v) =>
    `Hola ${v.clienteNombre}, su ONU se desconectó el ${v.fechaHora}.`,
  [TipoNotificacion.MANTENIMIENTO]:       (v) =>
    `Hola ${v.clienteNombre}, mantenimiento el ${v.fechaInicio} (~${v.duracionEstimada}). Motivo: ${v.motivo}`,
  [TipoNotificacion.ALERTA_EGRESO]:       (v) =>
    `Estimado Administrador, le recordamos que la obligación fija *${v.nombre_gasto}* de categoría *${v.categoria}* por un monto de *S/. ${v.monto}* está próxima a vencer. Días restantes: *${v.dias_restantes}*. Por favor, procese el pago desde el ERP.`,
};

// ─── Estrategia Twilio ────────────────────────────────────
// accountSid → apiKey, authToken → apiSecret, fromNumber → clientId
class TwilioStrategy implements IMensajeriaStrategy {
  private readonly logger = new Logger('TwilioStrategy');
  constructor(
    private readonly http:       HttpService,
    private readonly accountSid: string,
    private readonly authToken:  string,
    private readonly fromNumber: string,
  ) {}

  async enviarMensaje(telefono: string, texto: string): Promise<EnvioResult> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    try {
      const res = await firstValueFrom(
        this.http.post(
          url,
          new URLSearchParams({ To: `+${telefono}`, From: this.fromNumber, Body: texto }),
          {
            auth: { username: this.accountSid, password: this.authToken },
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 15_000,
          },
        ),
      );
      return { enviado: true, messageId: res.data?.sid };
    } catch (err) {
      const msg = err?.response?.data?.message || err.message;
      this.logger.error(`Twilio: ${msg}`);
      return { enviado: false, error: msg };
    }
  }
}

// ─── Estrategia Vonage ────────────────────────────────────
// apiKey → apiKey, apiSecret → apiSecret, senderName → clientId
class VonageStrategy implements IMensajeriaStrategy {
  private readonly logger = new Logger('VonageStrategy');
  constructor(
    private readonly http:      HttpService,
    private readonly apiKey:    string,
    private readonly apiSecret: string,
    private readonly from:      string,
  ) {}

  async enviarMensaje(telefono: string, texto: string): Promise<EnvioResult> {
    try {
      const res = await firstValueFrom(
        this.http.post(
          'https://rest.nexmo.com/sms/json',
          {
            api_key:    this.apiKey,
            api_secret: this.apiSecret,
            from:       this.from || 'DataFast',
            to:         telefono,
            text:       texto,
          },
          { timeout: 15_000 },
        ),
      );
      const msg = res.data?.messages?.[0];
      if (msg?.status === '0') return { enviado: true, messageId: msg['message-id'] };
      return { enviado: false, error: msg?.['error-text'] || 'Vonage error' };
    } catch (err) {
      const msg = err?.response?.data?.['error-text'] || err.message;
      this.logger.error(`Vonage: ${msg}`);
      return { enviado: false, error: msg };
    }
  }
}

// ─── Estrategia AutomatizadoVIP ──────────────────────────
// apiKey = Bearer token, clientId = instance/sender ID
class AutomatizadoVipStrategy implements IMensajeriaStrategy {
  private readonly logger = new Logger('AutomatizadoVipStrategy');
  private readonly BASE   = 'https://api.automatizado.vip/v1/send';
  constructor(
    private readonly http:       HttpService,
    private readonly apiKey:     string,
    private readonly instanceId: string,
  ) {}

  async enviarMensaje(telefono: string, texto: string, template: string): Promise<EnvioResult> {
    try {
      const res = await firstValueFrom(
        this.http.post(
          this.BASE,
          { to: telefono, text: texto, template, instanceId: this.instanceId || undefined },
          {
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type':  'application/json',
            },
            timeout: 15_000,
          },
        ),
      );
      return { enviado: true, messageId: res.data?.messageId || res.data?.id };
    } catch (err) {
      const msg = err?.response?.data?.message || err.message;
      this.logger.error(`AutomatizadoVIP: ${msg}`);
      return { enviado: false, error: msg };
    }
  }
}

// ─── Estrategia Custom API ────────────────────────────────
// X-API-Key header → apiKey, X-API-Secret header → apiSecret, endpointUrl → clientId
class CustomApiStrategy implements IMensajeriaStrategy {
  private readonly logger = new Logger('CustomApiStrategy');
  constructor(
    private readonly http:        HttpService,
    private readonly apiKey:      string,
    private readonly apiSecret:   string,
    private readonly endpointUrl: string,
  ) {}

  async enviarMensaje(telefono: string, texto: string, template: string): Promise<EnvioResult> {
    if (!this.endpointUrl) {
      return { enviado: false, error: 'CUSTOM_API: endpoint URL (clientId) no configurado' };
    }
    try {
      const res = await firstValueFrom(
        this.http.post(
          this.endpointUrl,
          { to: telefono, text: texto, template },
          {
            headers: {
              'X-API-Key':    this.apiKey,
              'X-API-Secret': this.apiSecret,
              'Content-Type': 'application/json',
            },
            timeout: 15_000,
          },
        ),
      );
      return { enviado: true, messageId: res.data?.messageId || res.data?.id };
    } catch (err) {
      const msg = err?.response?.data?.message || err.message;
      this.logger.error(`CustomAPI: ${msg}`);
      return { enviado: false, error: msg };
    }
  }
}

// ─── Config interna del gateway ───────────────────────────
interface GwConfig {
  proveedor:            ProveedorActivo;
  apiKey:               string;
  apiSecret:            string;
  clientId:             string;
  pausa:                number;
  limiteCaracteres:     number;
  codigoPais:           string;
  activo:               boolean;
  whatsappNumeroOrigen: string;
}

// ─────────────────────────────────────────────────────────────
// GatewayMensajeriaService — Selecciona la estrategia activa
// y delega el envío. Para META_GRAPH usa WhatsAppService.
// ─────────────────────────────────────────────────────────────
@Injectable()
export class GatewayMensajeriaService {
  private readonly logger = new Logger(GatewayMensajeriaService.name);

  constructor(
    private readonly whatsapp: WhatsAppService,
    private readonly http:     HttpService,
    @InjectDataSource() private readonly ds:    DataSource,
    @Inject(CACHE_MANAGER)  private readonly cache: Cache,
    @Optional() private readonly datafastNative: DatafastNativeStrategy,
  ) {}

  // ── Punto de entrada único para el worker ─────────────────
  async despachar(params: WhatsAppParams): Promise<EnvioResult> {
    const destino = await this.resolveDestino(params);

    if (!destino) {
      this.logger.warn(
        `[GW] Sin destino para ${params.tipo} (empresa=${params.empresaId}) — whatsapp_corporativo no configurado`,
      );
      return { enviado: false, error: 'Sin número destino configurado' };
    }

    // Registrar intento ANTES del envío — actualizado a ENVIADO_META | FALLIDO al terminar
    let logId: string | null = null;
    try {
      const [row] = await this.ds.query(`
        INSERT INTO notificaciones_logs (contrato_id, telefono, tipo_template, estado_entrega)
        VALUES ($1, $2, $3, 'ENCOLADO') RETURNING id
      `, [params.contratoId ?? null, destino.substring(0, 30), params.tipo]);
      logId = row?.id ?? null;
    } catch (logErr: any) {
      this.logger.warn(`[GW] No se pudo crear log: ${logErr.message}`);
    }

    const config = await this.resolveConfig(params.empresaId);
    let resultado: EnvioResult;

    if (!config || config.proveedor === 'META_GRAPH') {
      resultado = await this.whatsapp.enviar({ ...params, telefono: destino });
    } else if (!config.activo) {
      this.logger.warn(`[GW] Gateway desactivado para empresa ${params.empresaId}`);
      resultado = { enviado: false, error: 'Gateway desactivado' };
    } else {
      const texto = TEXTOS[params.tipo]?.(params.variables ?? {}) ?? String(params.tipo);

      if (texto.length > config.limiteCaracteres) {
        this.logger.warn(`[GW] Texto excede límite (${texto.length} > ${config.limiteCaracteres})`);
        resultado = { enviado: false, error: `Texto excede límite de ${config.limiteCaracteres} caracteres` };
      } else {
        const strategy = this.buildStrategy(config);
        if (!strategy) {
          this.logger.warn(`[GW] ${config.proveedor} sin credenciales — notificación omitida`);
          resultado = { enviado: false, error: `${config.proveedor} sin credenciales configuradas` };
        } else {
          const telefono = this.normalizarTelefono(destino, config.codigoPais);
          this.logger.log(`[GW] ${config.proveedor} → ${telefono} | ${params.tipo}`);
          resultado = await strategy.enviarMensaje(telefono, texto, params.tipo as string);
          if (config.pausa > 0) await this.sleep(config.pausa);
        }
      }
    }

    // Actualizar log con resultado final
    if (logId) {
      try {
        if (resultado.enviado) {
          await this.ds.query(
            `UPDATE notificaciones_logs SET estado_entrega = 'ENVIADO_META', meta_message_id = $1 WHERE id = $2`,
            [resultado.messageId ?? null, logId],
          );
        } else {
          await this.ds.query(
            `UPDATE notificaciones_logs SET estado_entrega = 'FALLIDO', error_detalle = $1 WHERE id = $2`,
            [(resultado.error ?? 'Error desconocido').substring(0, 500), logId],
          );
        }
      } catch (logErr: any) {
        this.logger.warn(`[GW] No se pudo actualizar log ${logId}: ${logErr.message}`);
      }
    }

    return resultado;
  }

  // ── Enrutamiento dual: interno usa whatsapp_corporativo ───
  private async resolveDestino(params: WhatsAppParams): Promise<string> {
    const tiposInternos: TipoNotificacion[] = [
      TipoNotificacion.ONU_OFFLINE,
      TipoNotificacion.ALERTA_EGRESO,
    ];
    if (tiposInternos.includes(params.tipo) && params.empresaId) {
      const [row] = await this.ds.query(
        `SELECT whatsapp_corporativo FROM empresas WHERE id = $1`,
        [params.empresaId],
      ).catch(() => [null]);
      if (row?.whatsapp_corporativo) return row.whatsapp_corporativo;
    }
    return params.telefono;
  }

  // ── Leer config de BD con caché 5 min ─────────────────────
  private async resolveConfig(empresaId?: string): Promise<GwConfig | null> {
    if (!empresaId) return null;
    const cacheKey = `gw:config:${empresaId}`;
    let cached = await this.cache.get<GwConfig | null>(cacheKey);

    if (cached === undefined) {
      const [row] = await this.ds.query(
        `SELECT proveedor_activo, gateway_api_key, gateway_api_secret, gateway_client_id,
                gateway_pausa, gateway_limite_caracteres, gateway_codigo_pais, gateway_activo,
                whatsapp_numero_origen
         FROM empresas WHERE id = $1`,
        [empresaId],
      ).catch(() => [null]);

      cached = row ? {
        proveedor:            (row.proveedor_activo ?? 'META_GRAPH') as ProveedorActivo,
        apiKey:               row.gateway_api_key           ?? '',
        apiSecret:            row.gateway_api_secret        ?? '',
        clientId:             row.gateway_client_id         ?? '',
        pausa:                row.gateway_pausa             ?? 2,
        limiteCaracteres:     row.gateway_limite_caracteres ?? 1000,
        codigoPais:           row.gateway_codigo_pais       ?? '+51',
        activo:               row.gateway_activo            ?? true,
        whatsappNumeroOrigen: row.whatsapp_numero_origen    ?? '',
      } : null;

      await this.cache.set(cacheKey, cached, 5 * 60 * 1000);
    }
    return cached;
  }

  // ── Instanciar la estrategia con credenciales descifradas ─
  private buildStrategy(config: GwConfig): IMensajeriaStrategy | null {
    let k = '';
    let s = '';
    try { k = config.apiKey    ? decrypt(config.apiKey)    : ''; } catch {}
    try { s = config.apiSecret ? decrypt(config.apiSecret) : ''; } catch {}

    switch (config.proveedor) {
      case 'TWILIO':           return (k && s) ? new TwilioStrategy(this.http, k, s, config.clientId)          : null;
      case 'VONAGE':           return (k && s) ? new VonageStrategy(this.http, k, s, config.clientId)          : null;
      case 'CUSTOM_API':       return k        ? new CustomApiStrategy(this.http, k, s, config.clientId)        : null;
      case 'AUTOMATIZADO_VIP':         return k               ? new AutomatizadoVipStrategy(this.http, k, config.clientId) : null;
      case 'DATAFAST_NATIVE':          return this.datafastNative ?? null;
      case 'DATAFAST_MENSAJERIA_MASIVA':
        return new DatafastMensajeriaMasivaStrategy(config.whatsappNumeroOrigen, config.codigoPais);
      default:                         return null;
    }
  }

  async invalidarCache(empresaId: string): Promise<void> {
    await this.cache.del(`gw:config:${empresaId}`).catch(() => {});
  }

  private normalizarTelefono(tel: string, codigoPais = '+51'): string {
    const clean    = tel.replace(/[^\d+]/g, '');
    const dialCode = codigoPais.replace('+', '');
    if (clean.startsWith('+'))        return clean.replace('+', '');
    if (clean.startsWith(dialCode))   return clean;
    if (clean.length <= 10)           return `${dialCode}${clean}`;
    return clean;
  }

  private sleep(seconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
  }
}
