import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { HttpService }    from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource }       from 'typeorm';
import { CACHE_MANAGER }    from '@nestjs/cache-manager';
import { Cache }            from 'cache-manager';
import { decrypt }          from '../../../common/utils/encryption.util';
import { WhatsAppService, TipoNotificacion, WhatsAppParams } from './whatsapp.service';
import { SYSTEM_DEFAULTS_WHATSAPP } from '../../plantillas/plantillas.service';
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

// ─── Mapping tipo → código de plantilla ───────────────────────
const TIPO_A_CODIGO: Record<string, string> = {
  factura_emitida:     'nueva_factura',
  pago_vence_hoy:      'aviso_pago_01',
  pago_vencido:        'aviso_pago_02',
  servicio_suspendido: 'corte_servicio',
  servicio_reactivado: 'reactivacion_servicio',
  servicio_activado:   'activacion_servicio',
  bienvenida:          'bienvenida',
  pago_recibido:       'confirmacion_pago',
  prorroga_concedida:  'prorroga_concedida',
  alerta_egreso:       'datafast_alerta_egreso',
  // Monitoreo de infraestructura
  emisor_caido:        'emisor_caido',
  emisor_conectado:    'emisor_conectado',
  router_caido:        'router_caido',
  router_conectado:    'router_conectado',
};

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
      // Actualizar log a NO_ENVIADO si existe antes de salir
      if (params.logId) {
        await this.ds.query(
          `UPDATE notificaciones_logs SET estado_entrega = 'NO_ENVIADO', error_detalle = $1 WHERE id = $2`,
          ['Sin número de destino configurado', params.logId],
        ).catch(() => {});
      }
      return { enviado: false, error: 'Sin número destino configurado' };
    }

    // Si el Worker ya creó el log (notificaciones individuales), reutilizarlo.
    // Para campañas masivas (sin logId), crear uno nuevo con estado ENCOLADO.
    let logId: string | null = params.logId ?? null;
    if (!logId) {
      try {
        const [row] = await this.ds.query(`
          INSERT INTO notificaciones_logs (empresa_id, contrato_id, telefono, tipo_template, estado_entrega)
          VALUES ($1, $2, $3, $4, 'ENCOLADO') RETURNING id
        `, [params.empresaId ?? null, params.contratoId ?? null, destino.substring(0, 30), params.tipo]);
        logId = row?.id ?? null;
      } catch (logErr: any) {
        this.logger.warn(`[GW] No se pudo crear log: ${logErr.message}`);
      }
    }

    const config = await this.resolveConfig(params.empresaId);
    let resultado: EnvioResult;
    let noEnviado = false;

    // Verificar switch de activación antes de cualquier despacho
    if (!config) {
      // Sin configuración de mensajería — no hay servicio activo para esta empresa
      this.logger.warn(`[GW] Sin config de mensajería para empresa ${params.empresaId}`);
      resultado = { enviado: false, error: 'Sin configuración de mensajería activa' };
      noEnviado = true;
    } else if (!config.activo) {
      this.logger.warn(`[GW] Servicio inactivo para empresa ${params.empresaId} (proveedor=${config.proveedor})`);
      resultado  = { enviado: false, error: 'Servicio de mensajería inactivo' };
      noEnviado  = true;
    } else if (config.proveedor === 'META_GRAPH') {
      resultado = await this.whatsapp.enviar({ ...params, telefono: destino });
      // WhatsApp retorna error de configuración cuando no hay token/phone_id
      if (!resultado.enviado && resultado.error === 'WhatsApp no configurado') {
        noEnviado = true;
      }
    } else {
      const texto = await this.resolveTexto(
        params.empresaId,
        params.tipo as string,
        params.contratoId,
        params.clienteId,
        params.variables ?? {},
      );

      if (texto === null) {
        this.logger.warn(`[GW] Sin plantilla para tipo='${params.tipo}' — notificación omitida`);
        resultado = { enviado: false, error: `Sin plantilla configurada para '${params.tipo}'` };
        noEnviado = true;
      } else if (texto.length > config.limiteCaracteres) {
        this.logger.warn(`[GW] Texto excede límite (${texto.length} > ${config.limiteCaracteres})`);
        resultado = { enviado: false, error: `Texto excede límite de ${config.limiteCaracteres} caracteres` };
      } else {
        const strategy = this.buildStrategy(config);
        if (!strategy) {
          this.logger.warn(`[GW] ${config.proveedor} sin credenciales — notificación omitida`);
          resultado  = { enviado: false, error: `${config.proveedor} sin credenciales configuradas` };
          noEnviado  = true;
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
        let nuevoEstado: string;
        const proveedorNombre = config?.proveedor ?? null;
        if (resultado.enviado) {
          nuevoEstado = 'ENVIADO';
          await this.ds.query(
            `UPDATE notificaciones_logs SET estado_entrega = 'ENVIADO', provider_message_id = $1, proveedor = $2 WHERE id = $3`,
            [resultado.messageId ?? null, proveedorNombre, logId],
          );
        } else if (noEnviado) {
          await this.ds.query(
            `UPDATE notificaciones_logs SET estado_entrega = 'NO_ENVIADO', error_detalle = $1, proveedor = $2 WHERE id = $3`,
            [(resultado.error ?? 'Sin servicio activo').substring(0, 500), proveedorNombre, logId],
          );
          nuevoEstado = 'NO_ENVIADO';
        } else {
          await this.ds.query(
            `UPDATE notificaciones_logs SET estado_entrega = 'FALLIDO', error_detalle = $1, proveedor = $2 WHERE id = $3`,
            [(resultado.error ?? 'Error desconocido').substring(0, 500), proveedorNombre, logId],
          );
          nuevoEstado = 'FALLIDO';
        }
        this.logger.log(`[GW] Log ${logId} → ${nuevoEstado}`);
      } catch (logErr: any) {
        this.logger.warn(`[GW] No se pudo actualizar log ${logId}: ${logErr.message}`);
      }
    }

    return resultado;
  }

  // ── Enrutamiento dual: alertas internas → whatsapp_corporativo ──
  // Los tipos internos no tienen telefono de cliente en el payload;
  // el destino es siempre el número corporativo de la empresa.
  private readonly TIPOS_INTERNOS = new Set<string>([
    TipoNotificacion.ONU_OFFLINE,
    TipoNotificacion.ALERTA_EGRESO,
    'emisor_caido',
    'emisor_conectado',
    'router_caido',
    'router_conectado',
  ]);

  private async resolveDestino(params: WhatsAppParams): Promise<string> {
    try {
      if (this.TIPOS_INTERNOS.has(params.tipo as string) && params.empresaId) {
        const [row] = await this.ds.query(
          `SELECT whatsapp_corporativo FROM empresas WHERE id = $1`,
          [params.empresaId],
        ).catch(() => [null]);
        if (row?.whatsapp_corporativo) return row.whatsapp_corporativo;
      }
    } catch (err: any) {
      this.logger.error(`[GW] Error en resolveDestino: ${err.message}`);
    }
    return params.telefono;
  }

  // ── Leer config de BD con caché 5 min ─────────────────────
  private async resolveConfig(empresaId?: string): Promise<GwConfig | null> {
    if (!empresaId) return null;
    const cacheKey = `gw:config:${empresaId}`;
    let cached: GwConfig | null | undefined;
    try {
      cached = await this.cache.get<GwConfig | null>(cacheKey);
    } catch {
      cached = undefined; // Redis caído → leer de BD
    }

    if (cached === undefined) {
      try {
        const [row] = await this.ds.query(
          `SELECT proveedor_activo, gateway_api_key, gateway_api_secret, gateway_client_id,
                  gateway_pausa, gateway_limite_caracteres, gateway_codigo_pais, gateway_activo,
                  meta_graph_activo, twilio_activo, vonage_activo, custom_api_activo, automatizado_vip_activo,
                  whatsapp_numero_origen
           FROM empresas WHERE id = $1`,
          [empresaId],
        );

        // Si proveedor_activo es null, la empresa no configuró mensajería → null = sin config
        const proveedor: string | null = row?.proveedor_activo ?? null;
        const activoMap: Record<string, boolean> = {
          META_GRAPH:                 row?.meta_graph_activo       ?? false,
          TWILIO:                     row?.twilio_activo           ?? false,
          VONAGE:                     row?.vonage_activo           ?? false,
          CUSTOM_API:                 row?.custom_api_activo       ?? false,
          AUTOMATIZADO_VIP:           row?.automatizado_vip_activo ?? false,
          DATAFAST_MENSAJERIA_MASIVA: row?.gateway_activo          ?? false,
        };
        cached = (row && proveedor) ? {
          proveedor:            proveedor as ProveedorActivo,
          apiKey:               row.gateway_api_key           ?? '',
          apiSecret:            row.gateway_api_secret        ?? '',
          clientId:             row.gateway_client_id         ?? '',
          pausa:                row.gateway_pausa             ?? 2,
          limiteCaracteres:     row.gateway_limite_caracteres ?? 1000,
          codigoPais:           row.gateway_codigo_pais       ?? '+51',
          activo:               activoMap[proveedor] ?? false,
          whatsappNumeroOrigen: row.whatsapp_numero_origen    ?? '',
        } : null;

        try {
          await this.cache.set(cacheKey, cached, 5 * 60 * 1000);
        } catch {
          // Redis caído — no bloquear
        }
      } catch {
        cached = null;
        this.logger.error(`[GW] Error leyendo config de BD para empresa ${empresaId}`);
      }
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
      case 'CUSTOM_API':       return (k && config.clientId) ? new CustomApiStrategy(this.http, k, s, config.clientId) : null;
      case 'AUTOMATIZADO_VIP':         return k               ? new AutomatizadoVipStrategy(this.http, k, config.clientId) : null;
      case 'DATAFAST_NATIVE':          return this.datafastNative ?? null;
      case 'DATAFAST_MENSAJERIA_MASIVA': {
        const evoKey = k || process.env.EVOLUTION_API_KEY || '';
        return evoKey ? new DatafastMensajeriaMasivaStrategy(
          this.http,
          evoKey,
          config.clientId || 'datafast_masivos',
          config.codigoPais,
        ) : null;
      }
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

  // ── Enriquece variables desde BD (contrato → cliente → plan → empresa) ──
  private async resolveVariables(
    empresaId: string | undefined,
    contratoId: string | undefined,
    clienteId: string | undefined,
    eventVars: Record<string, string>,
  ): Promise<Record<string, string>> {
    const base: Record<string, string> = {};

    if (contratoId) {
      try {
        const [row] = await this.ds.query(`
          SELECT
            cl.nombre_completo       AS nombre_cliente,
            em.razon_social          AS empresa,
            em.telefono              AS telefono_empresa,
            pl.nombre                AS plan,
            pl.velocidad_bajada::text AS velocidad_bajada,
            pl.velocidad_subida::text AS velocidad_subida,
            co.usuario_pppoe         AS usuario_pppoe,
            co.ip_asignada           AS ip_asignada,
            co.numero_contrato       AS numero_contrato
          FROM contratos co
          JOIN clientes  cl ON cl.id = co.cliente_id
          JOIN empresas  em ON em.id = co.empresa_id
          LEFT JOIN planes pl ON pl.id = co.plan_id
          WHERE co.id = $1
        `, [contratoId]);
        if (row) {
          for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
            if (v != null) base[k] = String(v);
          }
        }
      } catch (err: any) {
        this.logger.warn(`[GW] resolveVariables contratoId=${contratoId}: ${err.message}`);
      }
    } else if (clienteId && empresaId) {
      try {
        const [row] = await this.ds.query(`
          SELECT cl.nombre_completo AS nombre_cliente,
                 em.razon_social   AS empresa,
                 em.telefono       AS telefono_empresa
          FROM clientes cl, empresas em
          WHERE cl.id = $1 AND em.id = $2
        `, [clienteId, empresaId]);
        if (row) {
          for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
            if (v != null) base[k] = String(v);
          }
        }
      } catch (err: any) {
        this.logger.warn(`[GW] resolveVariables clienteId=${clienteId}: ${err.message}`);
      }
    } else if (empresaId) {
      try {
        const [row] = await this.ds.query(
          `SELECT razon_social AS empresa, telefono AS telefono_empresa FROM empresas WHERE id = $1`,
          [empresaId],
        );
        if (row) {
          for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
            if (v != null) base[k] = String(v);
          }
        }
      } catch (err: any) {
        this.logger.warn(`[GW] resolveVariables empresaId=${empresaId}: ${err.message}`);
      }
    }

    // Event vars override enriched vars (permite que el evento sobreescriba si necesita)
    return { ...base, ...eventVars };
  }

  // ── Resuelve plantilla + variables → texto final o null si no hay plantilla ──
  private async resolveTexto(
    empresaId: string | undefined,
    tipo: string,
    contratoId: string | undefined,
    clienteId: string | undefined,
    eventVars: Record<string, string>,
  ): Promise<string | null> {
    const codigo = TIPO_A_CODIGO[tipo];
    if (!codigo) {
      this.logger.warn(`[GW] Tipo '${tipo}' no tiene mapping en TIPO_A_CODIGO`);
      return null;
    }

    let contenido: string | null = null;

    // 1. Plantilla personalizada de la empresa en BD
    if (empresaId) {
      try {
        const [plantilla] = await this.ds.query(
          `SELECT contenido FROM plantillas_mensajes
           WHERE empresa_id = $1 AND tipo = 'whatsapp' AND codigo = $2 AND activo = true AND deleted_at IS NULL`,
          [empresaId, codigo],
        );
        if (plantilla?.contenido) contenido = plantilla.contenido;
      } catch (err: any) {
        this.logger.warn(`[GW] Error buscando plantilla ${codigo}: ${err.message}`);
      }
    }

    // 2. Fallback al sistema de plantillas por defecto
    if (!contenido) {
      contenido = SYSTEM_DEFAULTS_WHATSAPP[codigo]?.contenido ?? null;
    }

    if (!contenido) return null;

    // 3. Enriquecer con datos de BD y renderizar
    const vars = await this.resolveVariables(empresaId, contratoId, clienteId, eventVars);
    return contenido.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
  }

  private sleep(seconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
  }
}
