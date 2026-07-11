import {
  Injectable, Logger, BadRequestException, OnModuleInit,
  ServiceUnavailableException, NotFoundException, ConflictException,
} from '@nestjs/common';
import { HttpService }         from '@nestjs/axios';
import { InjectRepository }    from '@nestjs/typeorm';
import { InjectDataSource }    from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { firstValueFrom }      from 'rxjs';
import { AxiosRequestConfig }  from 'axios';
import { ModuleHealthService } from '../../common/services/module-health.service';
import { XuiServidor }         from './entities/xui-servidor.entity';
import { decrypt } from '../../common/utils/encryption.util';

// ─── Tipos de la API XUI ONE ───────────────────────────────────
// NOTA: los nombres de endpoint deben confirmarse contra la instancia real
// de XUI ONE de la empresa (panel admin → API); aquí se sigue la convención
// más extendida de estos paneles (Xtream-UI/XUI ONE reseller API).
export interface XuiBouquet {
  id:   number;
  name: string;
}

export interface XuiLineRemote {
  id:               string;
  username:         string;
  password:         string;
  bouquetIds:       number[];
  maxConnections:   number;
  enabled:          boolean;
}

export interface CrearXuiLinePayload {
  username:       string;
  password:       string;
  bouquetIds:     number[];
  maxConnections: number;
}

export interface XuiActiveStream {
  lineId:  string;
  channel: string;
}

export interface XuiChannelStatus {
  channelId:  number;
  nombre:     string;
  bouquetId:  number;
  online:     boolean;
}

interface XuiCredenciales {
  baseUrl: string;
  apiKey:  string;
}

// ─────────────────────────────────────────────────────────────
// Cliente HTTP para la API de XUI ONE — clon del patrón degradable
// de SmartoltApiService (circuit breaker, onModuleInit con probe).
// Config leída de la fila única `xui_servidores` en BD (no env vars) —
// ver xui-servidores.service.ts, que la crea/edita desde la UI.
// ─────────────────────────────────────────────────────────────
@Injectable()
export class XuiApiService implements OnModuleInit {
  private readonly logger = new Logger(XuiApiService.name);

  private baseUrl = '';
  private apiKey  = '';

  private degraded       = false;
  private degradedReason: string | null = null;

  private readonly CB_THRESHOLD = 3;
  private readonly CB_OPEN_MS   = 60_000;
  private cbFailures   = 0;
  private cbOpenAt: number | null = null;

  private readonly TIMEOUT_MS = 15_000;

  constructor(
    private readonly http:         HttpService,
    @InjectRepository(XuiServidor)
    private readonly servidorRepo: Repository<XuiServidor>,
    @InjectDataSource()
    private readonly dataSource:   DataSource,
    private readonly moduleHealth: ModuleHealthService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.recargarConfiguracion();
  }

  // Invocado por XuiServidoresService tras crear/editar la fila — hot
  // reload sin reiniciar el backend.
  async recargarConfiguracion(): Promise<void> {
    try {
      const [empresa] = await this.dataSource.query<any[]>(
        `SELECT id FROM empresas WHERE deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
      );
      const servidor = empresa
        ? await this.servidorRepo.findOne({ where: { empresaId: empresa.id } })
        : null;

      if (!servidor) {
        this.baseUrl  = '';
        this.apiKey   = '';
        this.degraded = true;
        this.degradedReason = 'servidor XUI no configurado';
        this.moduleHealth.registrar('xui', 'degraded', this.degradedReason);
        return;
      }

      this.baseUrl = servidor.apiUrl;
      this.apiKey  = decrypt(servidor.apiKey);

      const result = await this.verificarConectividad();
      if (result.conectado) {
        this.degraded = false;
        this.degradedReason = null;
        this.moduleHealth.registrar('xui', 'ok');
      } else {
        this.degraded       = true;
        this.degradedReason = result.mensaje;
        this.moduleHealth.registrar('xui', 'degraded', result.mensaje);
      }
    } catch (err: any) {
      this.degraded       = true;
      this.degradedReason = err.message;
      this.moduleHealth.registrar('xui', 'degraded', err.message);
    }
  }

  isDegraded():        boolean       { return this.degraded; }
  getDegradedReason(): string | null { return this.degradedReason; }

  assertNotDegraded(): void {
    if (this.degraded) {
      throw new ServiceUnavailableException(
        `Módulo XUI ONE no disponible: ${this.degradedReason ?? 'sin configuración o API inalcanzable'}`,
      );
    }
  }

  // ── Circuit breaker ───────────────────────────────────────────
  private checkCircuit(): void {
    if (this.cbOpenAt === null) return;
    const elapsed = Date.now() - this.cbOpenAt;
    if (elapsed < this.CB_OPEN_MS) {
      throw new ServiceUnavailableException(
        `XUI circuit breaker abierto — reintento en ${Math.ceil((this.CB_OPEN_MS - elapsed) / 1000)}s`,
      );
    }
    this.logger.log('[XUI CB] Entrando en HALF-OPEN — dejando pasar petición de prueba');
  }

  private onSuccess(): void {
    if (this.cbFailures > 0 || this.cbOpenAt !== null) {
      this.logger.log('[XUI CB] Éxito — reseteando circuit breaker');
    }
    this.cbFailures = 0;
    this.cbOpenAt   = null;
  }

  private onNetworkError(): void {
    this.cbFailures++;
    if (this.cbFailures >= this.CB_THRESHOLD) {
      this.cbOpenAt = Date.now();
      this.logger.error(
        `[XUI CB] Circuito ABIERTO tras ${this.cbFailures} fallos consecutivos — bloqueando ${this.CB_OPEN_MS / 1000}s`,
      );
    } else {
      this.logger.warn(`[XUI CB] Fallo de red ${this.cbFailures}/${this.CB_THRESHOLD}`);
    }
  }

  // ────────────────────────────────────────────────────────────
  // BOUQUETS (catálogo en vivo, sin duplicar en BD local)
  // ────────────────────────────────────────────────────────────

  async listarBouquets(): Promise<XuiBouquet[]> {
    const res = await this.get<any[]>('/api/bouquets');
    return (res || []).map((b) => ({ id: Number(b.id), name: String(b.name) }));
  }

  // ────────────────────────────────────────────────────────────
  // LINES
  // ────────────────────────────────────────────────────────────

  async crearLine(payload: CrearXuiLinePayload): Promise<XuiLineRemote> {
    this.assertNotDegraded();
    const body = {
      username:        payload.username,
      password:        payload.password,
      bouquet_ids:     payload.bouquetIds,
      max_connections: payload.maxConnections,
      enabled:         1,
    };
    const res = await this.post<any>('/api/line/create', body);
    if (!res?.id) {
      throw new BadRequestException('XUI ONE no retornó un ID de line válido');
    }
    return this.mapLine(res);
  }

  async editarLine(
    xuiLineId: string,
    cambios: Partial<CrearXuiLinePayload>,
  ): Promise<XuiLineRemote> {
    this.assertNotDegraded();
    const body: any = {};
    if (cambios.username)       body.username        = cambios.username;
    if (cambios.password)       body.password         = cambios.password;
    if (cambios.bouquetIds)     body.bouquet_ids      = cambios.bouquetIds;
    if (cambios.maxConnections) body.max_connections  = cambios.maxConnections;

    const res = await this.put<any>(`/api/line/${xuiLineId}`, body);
    return this.mapLine(res);
  }

  async eliminarLine(xuiLineId: string): Promise<void> {
    this.assertNotDegraded();
    await this.delete(`/api/line/${xuiLineId}`);
  }

  async getLine(xuiLineId: string): Promise<XuiLineRemote | null> {
    try {
      const res = await this.get<any>(`/api/line/${xuiLineId}`);
      return res ? this.mapLine(res) : null;
    } catch {
      return null;
    }
  }

  async buscarLinePorUsuario(username: string): Promise<XuiLineRemote | null> {
    try {
      const res = await this.get<any[]>('/api/line/search', { username });
      return res?.[0] ? this.mapLine(res[0]) : null;
    } catch {
      return null;
    }
  }

  async listarLineasRemoto(override?: XuiCredenciales): Promise<XuiLineRemote[]> {
    const res = await this.get<any[]>('/api/line/list', undefined, override);
    return (res || []).map((r) => this.mapLine(r));
  }

  private mapLine(raw: any): XuiLineRemote {
    return {
      id:             String(raw.id),
      username:       raw.username,
      password:       raw.password,
      bouquetIds:     (raw.bouquet_ids || []).map(Number),
      maxConnections: Number(raw.max_connections || 1),
      enabled:        !!raw.enabled,
    };
  }

  // ────────────────────────────────────────────────────────────
  // MONITOREO — canal actual por line + estado de canales (batch)
  // ────────────────────────────────────────────────────────────

  async getActiveStreams(): Promise<XuiActiveStream[]> {
    this.assertNotDegraded();
    const res = await this.get<any[]>('/api/streams/active');
    return (res || []).map((s) => ({
      lineId:  String(s.line_id),
      channel: String(s.channel_name || s.channel),
    }));
  }

  async getChannelsStatus(override?: XuiCredenciales): Promise<XuiChannelStatus[]> {
    if (!override) this.assertNotDegraded();
    const res = await this.get<any[]>('/api/streams/status', undefined, override);
    return (res || []).map((c) => ({
      channelId: Number(c.id),
      nombre:    String(c.name),
      bouquetId: Number(c.bouquet_id),
      online:    !!c.online,
    }));
  }

  async listarBouquetsRemoto(override: XuiCredenciales): Promise<XuiBouquet[]> {
    const res = await this.get<any[]>('/api/bouquets', undefined, override);
    return (res || []).map((b) => ({ id: Number(b.id), name: String(b.name) }));
  }

  // ────────────────────────────────────────────────────────────
  // PRUEBA DE CONEXIÓN Y CATÁLOGO — usados por el wizard del frontend
  // ANTES de persistir la configuración (xui-servidores.service.ts).
  // Stateless: nunca tocan this.baseUrl/this.apiKey ni el circuit breaker
  // de la instancia — probar una URL/key candidata no debe degradar el
  // servidor ya configurado y en uso.
  // ────────────────────────────────────────────────────────────

  async probarConexionExterna(apiUrl: string, apiKey: string): Promise<{ conectado: boolean; mensaje: string }> {
    if (!apiUrl || !apiKey) {
      return { conectado: false, mensaje: 'API URL y API Key son obligatorios' };
    }
    try {
      await this.get<any>('/api/status', undefined, { baseUrl: apiUrl, apiKey });
      return { conectado: true, mensaje: 'Conexión exitosa con XUI ONE' };
    } catch (error: any) {
      return { conectado: false, mensaje: `No se pudo conectar: ${error.message}` };
    }
  }

  async contarCatalogoRemoto(apiUrl: string, apiKey: string): Promise<{
    totalBouquets: number; totalCanales: number; totalLineas: number;
  }> {
    const override = { baseUrl: apiUrl, apiKey };
    const [bouquets, canales, lineas] = await Promise.all([
      this.listarBouquetsRemoto(override),
      this.getChannelsStatus(override),
      this.listarLineasRemoto(override).catch(() => []), // conteo best-effort
    ]);
    return {
      totalBouquets: bouquets.length,
      totalCanales:  canales.length,
      totalLineas:   lineas.length,
    };
  }

  // ────────────────────────────────────────────────────────────
  // VERIFICAR CONECTIVIDAD (config activa de la instancia)
  // ────────────────────────────────────────────────────────────

  async verificarConectividad(): Promise<{ conectado: boolean; mensaje: string }> {
    if (!this.baseUrl || !this.apiKey) {
      return { conectado: false, mensaje: 'XUI ONE no está configurado — agrega el servidor en /iptv → Servidores' };
    }
    return this.probarConexionExterna(this.baseUrl, this.apiKey);
  }

  // ────────────────────────────────────────────────────────────
  // HELPERS HTTP PRIVADOS
  // ────────────────────────────────────────────────────────────

  private getHeaders(apiKey: string): Record<string, string> {
    return {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
      'X-Client':      'DATAFAST-ISP/1.0',
    };
  }

  private getConfig(apiKey: string, params?: Record<string, any>): AxiosRequestConfig {
    return { headers: this.getHeaders(apiKey), timeout: this.TIMEOUT_MS, params };
  }

  private resolveCreds(override?: XuiCredenciales): XuiCredenciales {
    return override ?? { baseUrl: this.baseUrl, apiKey: this.apiKey };
  }

  private checkConfig(creds: XuiCredenciales): void {
    if (!creds.baseUrl) {
      throw new ServiceUnavailableException('XUI ONE no está configurado (API URL vacía).');
    }
    if (!creds.apiKey) {
      throw new ServiceUnavailableException('XUI ONE sin API key configurada.');
    }
  }

  private async get<T>(endpoint: string, params?: Record<string, any>, override?: XuiCredenciales): Promise<T> {
    const creds = this.resolveCreds(override);
    this.checkConfig(creds);
    if (!override) this.checkCircuit();
    try {
      const res = await firstValueFrom(
        this.http.get<T>(`${creds.baseUrl}${endpoint}`, this.getConfig(creds.apiKey, params)),
      );
      if (!override) this.onSuccess();
      return res.data;
    } catch (error) {
      this.handleHttpError(error, 'GET', endpoint, !!override);
    }
  }

  private async post<T>(endpoint: string, body: any, override?: XuiCredenciales): Promise<T> {
    const creds = this.resolveCreds(override);
    this.checkConfig(creds);
    if (!override) this.checkCircuit();
    try {
      const res = await firstValueFrom(
        this.http.post<T>(`${creds.baseUrl}${endpoint}`, body, this.getConfig(creds.apiKey)),
      );
      if (!override) this.onSuccess();
      return res.data;
    } catch (error) {
      this.handleHttpError(error, 'POST', endpoint, !!override);
    }
  }

  private async put<T>(endpoint: string, body: any, override?: XuiCredenciales): Promise<T> {
    const creds = this.resolveCreds(override);
    this.checkConfig(creds);
    if (!override) this.checkCircuit();
    try {
      const res = await firstValueFrom(
        this.http.put<T>(`${creds.baseUrl}${endpoint}`, body, this.getConfig(creds.apiKey)),
      );
      if (!override) this.onSuccess();
      return res.data;
    } catch (error) {
      this.handleHttpError(error, 'PUT', endpoint, !!override);
    }
  }

  private async delete(endpoint: string, override?: XuiCredenciales): Promise<void> {
    const creds = this.resolveCreds(override);
    this.checkConfig(creds);
    if (!override) this.checkCircuit();
    try {
      await firstValueFrom(
        this.http.delete(`${creds.baseUrl}${endpoint}`, this.getConfig(creds.apiKey)),
      );
      if (!override) this.onSuccess();
    } catch (error) {
      this.handleHttpError(error, 'DELETE', endpoint, !!override);
    }
  }

  private handleHttpError(error: any, method: string, endpoint: string, esExterno = false): never {
    const status  = error?.response?.status;
    const detail  = error?.response?.data;
    const message = detail?.message || detail?.error || error.message;

    this.logger.error(`XUI ${method} ${endpoint} → ${status || 'sin respuesta'}: ${message}`);

    if (status === 404) {
      throw new NotFoundException(`XUI ONE: recurso no encontrado (${endpoint})`);
    }
    if (status === 409) {
      throw new ConflictException(`XUI ONE: conflicto — ${message}`);
    }
    if (status === 400) {
      throw new BadRequestException(`XUI ONE rechazó la solicitud: ${message}`);
    }
    if (status === 401 || status === 403) {
      throw new ServiceUnavailableException('API key de XUI ONE inválida o expirada.');
    }
    if (!status) {
      // Las pruebas de conexión externas (wizard) no deben contaminar el
      // circuit breaker del servidor ya configurado y en uso.
      if (!esExterno) this.onNetworkError();
      throw new ServiceUnavailableException(`XUI ONE no disponible: ${message}. Verifica la API URL.`);
    }
    if (status >= 500 && !esExterno) {
      this.onNetworkError();
    }
    throw new ServiceUnavailableException(`Error XUI ONE (${status}): ${message}`);
  }
}
