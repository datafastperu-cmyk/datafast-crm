import { Injectable, Logger, Inject } from '@nestjs/common';
import { HttpService }    from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource }       from 'typeorm';
import { CACHE_MANAGER }    from '@nestjs/cache-manager';
import { Cache }            from 'cache-manager';
import { decrypt }              from '../../../common/utils/encryption.util';
import { normalizarTelefono }  from '../../../common/utils/telefono.util';
import { TipoNotificacion, WhatsAppParams } from './whatsapp.service';
import { SYSTEM_DEFAULTS_WHATSAPP, SYSTEM_DEFAULTS_EMAIL } from '../../plantillas/plantillas.service';
import { DatafastMensajeriaMasivaStrategy } from './datafast-mensajeria-masiva.strategy';
import { SmtpStrategy, SMTP_ASUNTOS }       from './smtp.strategy';
import { CircuitBreakerRegistry }           from '../../../common/services/circuit-breaker.registry';

export type ProveedorActivo =
  | 'CUSTOM_API'
  | 'AUTOMATIZADO_VIP'
  | 'DATAFAST_MENSAJERIA_MASIVA'
  | 'SMTP';

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
  // Infraestructura — Outbox agotado
  outbox_red_agotado:  'outbox_red_agotado',
  // IPTV — XUI ONE
  iptv_credenciales:   'iptv_credenciales',
};

// Orden de intento de fallback cuando el proveedor primario falla con error transitorio.
// Solo se usa el primero activo distinto al primario.
const FALLBACK_ORDER: ProveedorActivo[] = [
  'AUTOMATIZADO_VIP',
  'CUSTOM_API',
  'DATAFAST_MENSAJERIA_MASIVA',
  'SMTP',
];

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
  activoMap:            Record<string, boolean>;
  whatsappNumeroOrigen: string;
  // SMTP
  smtpHost:      string;
  smtpPort:      number;
  smtpUsuario:   string;
  smtpClave:     string;
  smtpFromName:  string;
  smtpFromEmail: string;
}

// Sentinel en Redis: la empresa no tiene plantilla personalizada para este código
const TMPL_NO_CUSTOM = '__no_custom__';

@Injectable()
export class GatewayMensajeriaService {
  private readonly logger = new Logger(GatewayMensajeriaService.name);

  // Estrategia singleton por empresa — evita re-descifrar credenciales en cada job
  private readonly strategyCache = new Map<string, { instance: IMensajeriaStrategy; fingerprint: string }>();

  constructor(
    private readonly http:  HttpService,
    private readonly cb:    CircuitBreakerRegistry,
    @InjectDataSource() private readonly ds:    DataSource,
    @Inject(CACHE_MANAGER)  private readonly cache: Cache,
  ) {}

  // ── Punto de entrada único para el worker ─────────────────
  async despachar(params: WhatsAppParams): Promise<EnvioResult> {
    const destino = await this.resolveDestino(params);

    if (!destino) {
      this.logger.warn(
        `[GW] Sin destino para ${params.tipo} (empresa=${params.empresaId}) — whatsapp_corporativo no configurado`,
      );
      if (params.logId) {
        // Actualizar log pre-creado por encolar() → visible en /mensajeria/enviados
        await this.ds.query(
          `UPDATE notificaciones_logs SET estado_entrega = 'NO_ENVIADO', error_detalle = $1 WHERE id = $2`,
          ['Sin número de destino configurado', params.logId],
        ).catch(() => {});
      } else if (params.empresaId) {
        // Log no fue pre-creado (encolar() falló en BD) → insertar ahora para garantizar visibilidad
        await this.ds.query(
          `INSERT INTO notificaciones_logs
             (empresa_id, contrato_id, cliente_id, telefono, tipo_template, estado_entrega, error_detalle, variables)
           VALUES ($1, $2, $3, $4, $5, 'NO_ENVIADO', $6, $7)`,
          [
            params.empresaId,
            params.contratoId ?? null,
            params.clienteId  ?? null,
            (params.telefono ?? '').substring(0, 30),
            params.tipo,
            'Sin número de destino configurado — whatsapp_corporativo no configurado',
            params.variables ? JSON.stringify(params.variables) : null,
          ],
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
    let proveedorUsado: string | null = config?.proveedor ?? null;

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
    } else {
      // Intento primario
      const primario = await this.tryEnvio(config.proveedor, config, params, destino);
      resultado  = primario.resultado;
      noEnviado  = primario.noEnviado;

      // Fallback: solo si el primario tuvo un fallo transitorio (no de configuración)
      if (!resultado.enviado && !noEnviado) {
        for (const candidato of FALLBACK_ORDER) {
          if (candidato === config.proveedor) continue;
          if (!config.activoMap[candidato])   continue;
          this.logger.warn(
            `[GW] Primario ${config.proveedor} falló → fallback a ${candidato} (empresa=${params.empresaId})`,
          );
          const fb = await this.tryEnvio(candidato, config, params, destino);
          resultado = fb.resultado;
          noEnviado = fb.noEnviado;
          if (resultado.enviado) proveedorUsado = candidato;
          break; // un solo intento de fallback
        }
      }
    }

    // Actualizar log con resultado final
    if (logId) {
      try {
        let nuevoEstado: string;
        const proveedorNombre = proveedorUsado;
        if (resultado.enviado) {
          nuevoEstado = 'ENVIADO';
          await this.ds.query(
            `UPDATE notificaciones_logs SET estado_entrega = 'ENVIADO', provider_message_id = $1, proveedor = $2, sent_at = NOW() WHERE id = $3`,
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

  // ── Despacho para un proveedor concreto (reutilizado en primario y fallback) ──
  private async tryEnvio(
    proveedor: ProveedorActivo,
    config: GwConfig,
    params: WhatsAppParams,
    destino: string,
  ): Promise<{ resultado: EnvioResult; noEnviado: boolean }> {
    let resultado: EnvioResult;
    let noEnviado = false;

    if (proveedor === 'SMTP') {
      const emailDestino = await this.resolveClientEmail(params);
      if (!emailDestino) {
        return { resultado: { enviado: false, error: 'Sin email de cliente configurado' }, noEnviado: true };
      }
      const asunto = SMTP_ASUNTOS[params.tipo as string] ?? (params.tipo as string);
      const textoEmail = await this.resolveTexto(
        params.empresaId, params.tipo as string,
        params.contratoId, params.clienteId, params.variables ?? {}, 'email',
      );
      if (textoEmail === null) {
        return { resultado: { enviado: false, error: `Sin plantilla email para '${params.tipo}'` }, noEnviado: true };
      }
      const smtpConfig: GwConfig = { ...config, proveedor: 'SMTP' };
      const strategy = this.buildStrategy(smtpConfig, params.empresaId);
      if (!strategy) {
        return { resultado: { enviado: false, error: 'SMTP sin credenciales configuradas' }, noEnviado: true };
      }
      const cbKey = `${params.empresaId ?? 'global'}:SMTP`;
      if (!this.cb.canProceed(cbKey)) {
        return { resultado: { enviado: false, error: 'Circuit breaker OPEN: SMTP' }, noEnviado: true };
      }
      this.logger.log(`[GW] SMTP → ${emailDestino} | ${params.tipo}`);
      resultado = await strategy.enviarMensaje(emailDestino, textoEmail, asunto);
      if (resultado.enviado) this.cb.onSuccess(cbKey); else this.cb.onFailure(cbKey);

    } else {
      const texto = await this.resolveTexto(
        params.empresaId, params.tipo as string,
        params.contratoId, params.clienteId, params.variables ?? {},
      );
      if (texto === null) {
        return { resultado: { enviado: false, error: `Sin plantilla para '${params.tipo}'` }, noEnviado: true };
      }
      if (texto.length > config.limiteCaracteres) {
        return { resultado: { enviado: false, error: `Texto excede límite ${config.limiteCaracteres}` }, noEnviado: true };
      }
      const gwConfig: GwConfig = { ...config, proveedor };
      const strategy = this.buildStrategy(gwConfig, params.empresaId);
      if (!strategy) {
        return { resultado: { enviado: false, error: `${proveedor} sin credenciales configuradas` }, noEnviado: true };
      }
      const cbKey = `${params.empresaId ?? 'global'}:${proveedor}`;
      if (!this.cb.canProceed(cbKey)) {
        return { resultado: { enviado: false, error: `Circuit breaker OPEN: ${proveedor}` }, noEnviado: true };
      }
      const telefono = normalizarTelefono(destino, config.codigoPais) ?? destino;
      this.logger.log(`[GW] ${proveedor} → ${telefono} | ${params.tipo}`);
      resultado = await strategy.enviarMensaje(telefono, texto, params.tipo as string);
      if (resultado.enviado) {
        this.cb.onSuccess(cbKey);
      } else {
        this.cb.onFailure(cbKey);
      }
      if (config.pausa > 0) await this.sleep(config.pausa);
    }

    return { resultado, noEnviado };
  }

  // ── Enrutamiento dual: alertas internas → whatsapp_corporativo ──
  // Los tipos internos no tienen telefono de cliente en el payload;
  // el destino es siempre el número corporativo de la empresa.
  private readonly TIPOS_INTERNOS = new Set<string>([
    TipoNotificacion.ALERTA_EGRESO,
    'emisor_caido',
    'emisor_conectado',
    'router_caido',
    'router_conectado',
    'outbox_red_agotado',
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
                  custom_api_activo, automatizado_vip_activo, smtp_activo,
                  smtp_host, smtp_port, smtp_usuario, smtp_clave, smtp_from_name, smtp_from_email,
                  whatsapp_numero_origen
           FROM empresas WHERE id = $1`,
          [empresaId],
        );

        // Si proveedor_activo es null, la empresa no configuró mensajería → null = sin config
        const proveedor: string | null = row?.proveedor_activo ?? null;
        const activoMap: Record<string, boolean> = {
          CUSTOM_API:                 row?.custom_api_activo       ?? false,
          AUTOMATIZADO_VIP:           row?.automatizado_vip_activo ?? false,
          DATAFAST_MENSAJERIA_MASIVA: row?.gateway_activo          ?? false,
          SMTP:                       row?.smtp_activo             ?? false,
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
          activoMap,
          whatsappNumeroOrigen: row.whatsapp_numero_origen    ?? '',
          smtpHost:      row.smtp_host       ?? '',
          smtpPort:      row.smtp_port       ?? 587,
          smtpUsuario:   row.smtp_usuario    ?? '',
          smtpClave:     row.smtp_clave      ?? '',
          smtpFromName:  row.smtp_from_name  ?? '',
          smtpFromEmail: row.smtp_from_email ?? '',
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

  // ── Estrategia singleton por empresa ─────────────────────────
  // La huella incluye proveedor + credenciales encriptadas: si cambian en BD,
  // la próxima llamada creará una nueva instancia automáticamente.
  private buildStrategy(config: GwConfig, empresaId?: string): IMensajeriaStrategy | null {
    const fingerprint = `${config.proveedor}:${config.apiKey}:${config.apiSecret}:${config.clientId}:${config.smtpHost ?? ''}:${config.smtpUsuario ?? ''}:${config.smtpClave ?? ''}`;
    const slotKey     = `${empresaId ?? '_global_'}:${config.proveedor}`;
    const cached      = this.strategyCache.get(slotKey);
    if (cached?.fingerprint === fingerprint) return cached.instance;

    let k = '';
    let s = '';
    try { k = config.apiKey    ? decrypt(config.apiKey)    : ''; } catch {}
    try { s = config.apiSecret ? decrypt(config.apiSecret) : ''; } catch {}

    let instance: IMensajeriaStrategy | null = null;
    switch (config.proveedor) {
      case 'CUSTOM_API':
        instance = (k && config.clientId) ? new CustomApiStrategy(this.http, k, s, config.clientId) : null;
        break;
      case 'AUTOMATIZADO_VIP':
        instance = k ? new AutomatizadoVipStrategy(this.http, k, config.clientId) : null;
        break;
      case 'DATAFAST_MENSAJERIA_MASIVA': {
        const evoKey = k || process.env.EVOLUTION_API_KEY || '';
        instance = evoKey ? new DatafastMensajeriaMasivaStrategy(
          this.http, evoKey, config.clientId || 'datafast_masivos', config.codigoPais,
        ) : null;
        break;
      }
      case 'SMTP': {
        let smtpPass = '';
        try { smtpPass = config.smtpClave ? decrypt(config.smtpClave) : ''; } catch {}
        const secure = config.smtpPort === 465;
        instance = (config.smtpHost && config.smtpUsuario && smtpPass)
          ? new SmtpStrategy(config.smtpHost, config.smtpPort, secure, config.smtpUsuario, smtpPass, config.smtpFromName, config.smtpFromEmail)
          : null;
        break;
      }
    }

    if (instance) {
      this.strategyCache.set(slotKey, { instance, fingerprint });
      this.logger.log(`[GW] Estrategia ${config.proveedor} (re)creada — empresa=${slotKey}`);
    }
    return instance;
  }

  async invalidarCache(empresaId: string): Promise<void> {
    await this.cache.del(`gw:config:${empresaId}`).catch(() => {});
    // Borrar todas las entradas de estrategia para esta empresa (formato: "{empresaId}:{proveedor}")
    for (const key of this.strategyCache.keys()) {
      if (key.startsWith(`${empresaId}:`)) this.strategyCache.delete(key);
    }
  }

  // ── Enriquece variables desde BD (contrato → cliente → plan → empresa) ──
  private async resolveVariables(
    empresaId: string | undefined,
    contratoId: string | undefined,
    clienteId: string | undefined,
    eventVars: Record<string, string>,
  ): Promise<Record<string, string>> {
    const base: Record<string, string> = {};
    const TTL_MS = 120_000;

    if (contratoId) {
      const cacheKey = `vars:contrato:${contratoId}`;
      const cached = await this.cache.get<Record<string, string>>(cacheKey);
      if (cached) {
        Object.assign(base, cached);
      } else {
        try {
          const [row] = await this.ds.query(`
            SELECT
              cl.nombre_completo       AS nombre_cliente,
              cl.nombre_completo       AS nombre_completo,
              em.razon_social          AS empresa,
              em.razon_social          AS empresa_nombre,
              em.telefono              AS telefono_empresa,
              pl.nombre                AS plan,
              pl.nombre                AS plan_contratado,
              pl.velocidad_bajada::text AS velocidad_bajada,
              pl.velocidad_subida::text AS velocidad_subida,
              co.usuario_pppoe         AS usuario_pppoe,
              co.ip_asignada           AS ip_asignada,
              co.numero_contrato       AS numero_contrato,
              co.deuda_total::text     AS deuda_total,
              co.deuda_total::text     AS monto,
              co.meses_deuda::text     AS dias_vencidos,
              co.meses_deuda::text     AS meses_deuda
            FROM contratos co
            JOIN clientes  cl ON cl.id = co.cliente_id
            JOIN empresas  em ON em.id = co.empresa_id
            LEFT JOIN planes pl ON pl.id = co.plan_id
            WHERE co.id = $1
          `, [contratoId]);
          if (row) {
            const fetched: Record<string, string> = {};
            for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
              if (v != null) fetched[k] = String(v);
            }
            Object.assign(base, fetched);
            await this.cache.set(cacheKey, fetched, TTL_MS);
          }
        } catch (err: any) {
          this.logger.warn(`[GW] resolveVariables contratoId=${contratoId}: ${err.message}`);
        }
      }
    } else if (clienteId && empresaId) {
      const cacheKey = `vars:cliente:${clienteId}:${empresaId}`;
      const cached = await this.cache.get<Record<string, string>>(cacheKey);
      if (cached) {
        Object.assign(base, cached);
      } else {
        try {
          const [row] = await this.ds.query(`
            SELECT cl.nombre_completo AS nombre_cliente,
                   cl.nombre_completo AS nombre_completo,
                   em.razon_social   AS empresa,
                   em.razon_social   AS empresa_nombre,
                   em.telefono       AS telefono_empresa
            FROM clientes cl, empresas em
            WHERE cl.id = $1 AND em.id = $2
          `, [clienteId, empresaId]);
          if (row) {
            const fetched: Record<string, string> = {};
            for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
              if (v != null) fetched[k] = String(v);
            }
            Object.assign(base, fetched);
            await this.cache.set(cacheKey, fetched, TTL_MS);
          }
        } catch (err: any) {
          this.logger.warn(`[GW] resolveVariables clienteId=${clienteId}: ${err.message}`);
        }
      }
    } else if (empresaId) {
      const cacheKey = `vars:empresa:${empresaId}`;
      const cached = await this.cache.get<Record<string, string>>(cacheKey);
      if (cached) {
        Object.assign(base, cached);
      } else {
        try {
          const [row] = await this.ds.query(
            `SELECT razon_social AS empresa, razon_social AS empresa_nombre,
                    telefono AS telefono_empresa FROM empresas WHERE id = $1`,
            [empresaId],
          );
          if (row) {
            const fetched: Record<string, string> = {};
            for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
              if (v != null) fetched[k] = String(v);
            }
            Object.assign(base, fetched);
            await this.cache.set(cacheKey, fetched, TTL_MS);
          }
        } catch (err: any) {
          this.logger.warn(`[GW] resolveVariables empresaId=${empresaId}: ${err.message}`);
        }
      }
    }

    // Garantizar que siempre haya un valor para empresa
    if (!base['empresa'])      base['empresa']      = 'DATAFAST';
    if (!base['empresa_nombre']) base['empresa_nombre'] = 'DATAFAST';
    if (!base['telefono_empresa']) base['telefono_empresa'] = '—';

    // Alias: mapear nombres de variables comunes de eventos a los esperados por plantillas
    // Esto permite que los templates usen {{monto}} aunque el evento envíe deudaTotal
    const aliasMap: Record<string, string[]> = {
      monto:             ['deudaTotal', 'deuda_total', 'monto_factura', 'montoPago', 'montoDeuda'],
      deuda_total:       ['deudaTotal', 'monto'],
      monto_factura:     ['montoTotal', 'monto'],
      dias_vencidos:     ['diasVencido', 'meses_deuda'],
      dias_vencimiento:  ['diasVencido'],
      fecha_pago:        ['fechaVencimiento', 'fecha_vencimiento', 'fechaProrroga'],
      fecha_vencimiento: ['fechaProrroga', 'fechaVencimiento'],
      plan_contratado:   ['planNombre', 'plan_nombre'],
      usuario_pppoe:     ['usuarioPppoe'],
      ip_asignada:       ['ipAsignada'],
      nombre_completo:   ['nombre_cliente', 'clienteNombre'],
      clienteNombre:     ['nombre_cliente', 'nombre_completo'],
      empresa_nombre:    ['nombreEmpresa', 'empresa'],
      telefono_empresa:  ['telefono'],
      numero_factura:    ['facturaNumero'],
      numero_cuenta:     ['numeroCuenta'],
      link_pago:         ['linkPago'],
      metodo_pago:       ['metodoPago'],
      saldo_pendiente:   ['saldoPendiente'],
      nodo_nombre:       ['nodoNombre'],
      router_nombre:     ['routerNombre'],
    };

    // Para cada alias, si el destino no tiene valor pero el origen sí, copiarlo
    for (const [target, sources] of Object.entries(aliasMap)) {
      if (base[target]) continue; // ya tiene valor
      for (const src of sources) {
        if (eventVars[src]) {
          base[target] = eventVars[src];
          break;
        }
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
    canalPlantilla: 'whatsapp' | 'email' = 'whatsapp',
  ): Promise<string | null> {
    const codigo = TIPO_A_CODIGO[tipo];
    if (!codigo) {
      this.logger.warn(`[GW] Tipo '${tipo}' no tiene mapping en TIPO_A_CODIGO`);
      return null;
    }

    let contenido: string | null = null;

    // 1. Plantilla personalizada — con caché Redis 10 min para evitar query por mensaje
    if (empresaId) {
      const tmplKey = `tmpl:${empresaId}:${canalPlantilla}:${codigo}`;
      try {
        const cached = await this.cache.get<string>(tmplKey);
        if (cached !== undefined && cached !== null) {
          // Hit: sentinel significa "no hay plantilla personalizada"
          contenido = cached === TMPL_NO_CUSTOM ? null : cached;
        } else {
          // Miss: consultar BD y guardar resultado en caché
          const [plantilla] = await this.ds.query(
            `SELECT contenido FROM plantillas_mensajes
             WHERE empresa_id = $1 AND tipo = $3 AND codigo = $2 AND activo = true AND deleted_at IS NULL`,
            [empresaId, codigo, canalPlantilla],
          );
          contenido = plantilla?.contenido ?? null;
          await this.cache.set(tmplKey, contenido ?? TMPL_NO_CUSTOM, 10 * 60 * 1000).catch(() => {});
        }
      } catch {
        // Redis caído → consultar BD directamente sin cachear
        try {
          const [plantilla] = await this.ds.query(
            `SELECT contenido FROM plantillas_mensajes
             WHERE empresa_id = $1 AND tipo = $3 AND codigo = $2 AND activo = true AND deleted_at IS NULL`,
            [empresaId, codigo, canalPlantilla],
          );
          contenido = plantilla?.contenido ?? null;
        } catch (dbErr: any) {
          this.logger.warn(`[GW] Error buscando plantilla ${codigo}: ${dbErr.message}`);
        }
      }
    }

    // 2. Fallback al sistema de plantillas por defecto (en memoria, sin query)
    if (!contenido) {
      contenido = canalPlantilla === 'email'
        ? (SYSTEM_DEFAULTS_EMAIL[codigo]?.contenido ?? null)
        : (SYSTEM_DEFAULTS_WHATSAPP[codigo]?.contenido ?? null);
    }

    if (!contenido) return null;

    // 3. Enriquecer con datos de BD y renderizar
    const vars = await this.resolveVariables(empresaId, contratoId, clienteId, eventVars);
    return contenido.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      const value = vars[key];
      if (value === undefined) {
        this.logger.warn(`[GW] Variable '{{${key}}}' sin valor en plantilla '${codigo}' (tipo=${tipo})`);
      }
      return value ?? '';
    });
  }

  private async resolveClientEmail(params: WhatsAppParams): Promise<string | null> {
    try {
      if (params.contratoId) {
        const [row] = await this.ds.query(
          `SELECT cl.email FROM contratos co JOIN clientes cl ON cl.id = co.cliente_id WHERE co.id = $1`,
          [params.contratoId],
        );
        return row?.email ?? null;
      }
      if (params.clienteId) {
        const [row] = await this.ds.query(
          `SELECT email FROM clientes WHERE id = $1`,
          [params.clienteId],
        );
        return row?.email ?? null;
      }
    } catch (err: any) {
      this.logger.warn(`[GW] resolveClientEmail: ${err.message}`);
    }
    return null;
  }

  private sleep(seconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
  }
}
