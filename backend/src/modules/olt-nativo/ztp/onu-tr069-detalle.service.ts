import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { Tr069GenieacsClient } from '../../tr069/tr069-genieacs.client';
import { GenieAcsDriver } from './genieacs.driver';
import { getParameterMap, matchDeviceProfile } from './registry';
import { ExecutionPlan, ExecutionPlanWrite } from './ztp.contracts';
import { ContratoOnuConfigService } from './contrato-onu-config.service';

// ── DTOs de edición LIVE ────────────────────────────────────────────────────
export class SetWifiLiveDto {
  @IsIn(['2.4', '5']) band: '2.4' | '5';
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MaxLength(32) ssid?: string;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(63) password?: string;
}
export class SetPppoeLiveDto {
  @IsOptional() @IsString() @MaxLength(64) username?: string;
  @IsOptional() @IsString() @MaxLength(64) password?: string;
}
export class SetAccesoWebDto {
  @IsOptional() @IsString() @MaxLength(64) adminUser?: string;
  @IsOptional() @IsString() @MinLength(6) @MaxLength(64) adminPassword?: string;
  @IsOptional() @IsString() @MaxLength(64) userUser?: string;
  @IsOptional() @IsString() @MinLength(6) @MaxLength(64) userPassword?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// OnuTr069DetalleService — lectura/acciones LIVE de una ONU vía TR-069 (GenieACS).
//
// Modelo "sesión LIVE on-demand": el plano de gestión está SIEMPRE configurado (la ONU
// informa periódicamente). Abrir el detalle NO reconfigura la OLT: dispara un
// ConnectionRequest para traer datos frescos y lee el árbol de GenieACS. Cerrar el
// detalle solo detiene el refresco en el frontend — no hay estado de sesión en el server.
//
// Fase 1: panel de info + WiFi (2.4/5G) + PPP + acciones (refresh/reboot/factory-reset)
// + edición de WiFi/PPPoE (reutiliza el fallback por priority-list del GenieAcsDriver).
// ═══════════════════════════════════════════════════════════════════════════

export interface OnuWifiBand {
  band:    '2.4' | '5';
  index:   number;
  enabled: boolean | null;
  ssid:    string | null;
}
export interface OnuPppLink {
  index:            string;
  username:         string | null;
  connectionStatus: string | null;
  externalIp:       string | null;
}
export interface OnuHost {
  hostname: string | null;
  ip:       string | null;
  mac:      string | null;
  active:   boolean | null;
  /** Cómo está conectado: banda WiFi, WiFi genérico o cable. */
  conexion: '2.4' | '5' | 'wifi' | 'lan';
}
export interface OnuTr069Detalle {
  informing:   boolean;
  deviceId?:   string;
  lastInform?: string | null;
  info?: {
    serial?:          string;
    manufacturer?:    string;
    productClass?:    string;
    modelName?:       string;
    softwareVersion?: string;
    hardwareVersion?: string;
    mgmtIp?:          string | null;
    uptimeSeconds?:   number | null;
    profileMatched:   boolean;
  };
  wifi?: OnuWifiBand[];
  ppp?:  OnuPppLink[];
  hosts?: OnuHost[];
}

@Injectable()
export class OnuTr069DetalleService {
  private readonly logger = new Logger(OnuTr069DetalleService.name);

  constructor(
    private readonly nbi: Tr069GenieacsClient,
    private readonly driver: GenieAcsDriver,
    private readonly onuConfig: ContratoOnuConfigService,
  ) {}

  isReady(): boolean {
    return this.nbi.isConfigured();
  }

  private _assertReady(): void {
    if (!this.isReady()) {
      throw new ServiceUnavailableException('GenieACS NBI no configurado — el plano TR-069 está degradado.');
    }
  }

  /** Lee `_value` en una ruta punteada del doc de GenieACS. */
  private _val(dev: any, dotted: string): any {
    let n = dev;
    for (const seg of dotted.split('.')) {
      if (n == null || typeof n !== 'object') return undefined;
      n = n[seg];
    }
    return n && typeof n === 'object' && '_value' in n ? n._value : undefined;
  }

  private _host(url?: string): string | null {
    if (!url) return null;
    try { return new URL(url).hostname; } catch { return null; }
  }

  // ── Lectura del detalle ───────────────────────────────────────────────────
  async getDetalle(serial: string): Promise<OnuTr069Detalle> {
    this._assertReady();
    const deviceId = await this.driver.findDeviceIdBySerial(serial);
    if (!deviceId) return { informing: false };

    const dev = await this.nbi.getDevice(deviceId);
    if (!dev) return { informing: false, deviceId };

    const did  = dev._deviceId ?? {};
    const igd  = dev.InternetGatewayDevice ?? {};
    const info = igd.DeviceInfo ?? {};
    const runtime = {
      manufacturer:    did._Manufacturer,
      productClass:    did._ProductClass,
      modelName:       info.ModelName?._value,
      softwareVersion: info.SoftwareVersion?._value,
      hardwareVersion: info.HardwareVersion?._value,
    };
    const profile = matchDeviceProfile(runtime as any);

    // WiFi 2.4G (WLANConfiguration.1) y 5G (WLANConfiguration.5)
    const wifi: OnuWifiBand[] = [];
    for (const [band, idx] of [['2.4', 1], ['5', 5]] as const) {
      const base = `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}`;
      const ssid = this._val(dev, `${base}.SSID`);
      const en   = this._val(dev, `${base}.Enable`);
      if (ssid !== undefined || en !== undefined) {
        wifi.push({ band, index: idx, enabled: en ?? null, ssid: ssid ?? null });
      }
    }

    // PPP (todos los WANConnectionDevice que tengan WANPPPConnection.1)
    const ppp: OnuPppLink[] = [];
    const wcd = dev.InternetGatewayDevice?.WANDevice?.['1']?.WANConnectionDevice ?? {};
    for (const k of Object.keys(wcd)) {
      if (k.startsWith('_')) continue;
      const pppBase = `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${k}.WANPPPConnection.1`;
      const user = this._val(dev, `${pppBase}.Username`);
      if (user !== undefined || wcd[k]?.WANPPPConnection) {
        ppp.push({
          index:            k,
          username:         user ?? null,
          connectionStatus: this._val(dev, `${pppBase}.ConnectionStatus`) ?? null,
          externalIp:       this._val(dev, `${pppBase}.ExternalIPAddress`) ?? null,
        });
      }
    }

    // Dispositivos conectados (Hosts) + banda WiFi por MAC (AssociatedDevice de cada WLAN).
    const wlanRoot = igd.LANDevice?.['1']?.WLANConfiguration ?? {};
    const macBand = new Map<string, '2.4' | '5'>();
    for (const [idx, band] of [['1', '2.4'], ['5', '5']] as const) {
      const ad = wlanRoot[idx]?.AssociatedDevice ?? {};
      for (const k of Object.keys(ad)) {
        if (k.startsWith('_')) continue;
        const mac = this._val(dev, `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.AssociatedDevice.${k}.AssociatedDeviceMACAddress`);
        if (mac) macBand.set(String(mac).toLowerCase(), band);
      }
    }
    const hosts: OnuHost[] = [];
    const hostRoot = igd.LANDevice?.['1']?.Hosts?.Host ?? {};
    for (const k of Object.keys(hostRoot)) {
      if (k.startsWith('_')) continue;
      const base   = `InternetGatewayDevice.LANDevice.1.Hosts.Host.${k}`;
      const mac    = this._val(dev, `${base}.MACAddress`);
      const iftype = this._val(dev, `${base}.InterfaceType`);
      const layer2 = this._val(dev, `${base}.Layer2Interface`) ?? this._val(dev, `${base}.Layer1Interface`);
      let conexion: OnuHost['conexion'] = mac ? (macBand.get(String(mac).toLowerCase()) ?? 'lan') : 'lan';
      if (conexion === 'lan' && typeof layer2 === 'string') {
        if (/WLANConfiguration\.5\b/.test(layer2)) conexion = '5';
        else if (/WLANConfiguration\.1\b/.test(layer2)) conexion = '2.4';
      }
      if (conexion === 'lan' && /802\.11|wifi|wlan/i.test(String(iftype ?? ''))) conexion = 'wifi';
      hosts.push({
        hostname: this._val(dev, `${base}.HostName`) ?? null,
        ip:       this._val(dev, `${base}.IPAddress`) ?? null,
        mac:      mac ?? null,
        active:   this._val(dev, `${base}.Active`) ?? null,
        conexion,
      });
    }

    return {
      informing: true,
      deviceId,
      lastInform: dev._lastInform ?? null,
      info: {
        serial:          did._SerialNumber,
        manufacturer:    runtime.manufacturer,
        productClass:    runtime.productClass,
        modelName:       runtime.modelName,
        softwareVersion: runtime.softwareVersion,
        hardwareVersion: runtime.hardwareVersion,
        mgmtIp:          this._host(this._val(dev, 'InternetGatewayDevice.ManagementServer.ConnectionRequestURL')),
        uptimeSeconds:   this._val(dev, 'InternetGatewayDevice.DeviceInfo.UpTime') ?? null,
        profileMatched:  !!profile,
      },
      wifi,
      ppp,
      hosts,
    };
  }

  // ── Acciones ──────────────────────────────────────────────────────────────
  private async _deviceIdOrThrow(serial: string): Promise<string> {
    this._assertReady();
    const deviceId = await this.driver.findDeviceIdBySerial(serial);
    if (!deviceId) throw new NotFoundException(`La ONU ${serial} no está informando a GenieACS.`);
    return deviceId;
  }

  /** ConnectionRequest + refreshObject de los árboles del panel → devuelve el detalle fresco. */
  async refresh(serial: string): Promise<OnuTr069Detalle> {
    const deviceId = await this._deviceIdOrThrow(serial);
    // Acotar la cola (CNT-2026-000004, fase gestión continua): si la ONU está inalcanzable,
    // cada refresh acumulaba tareas de lectura sin límite (llegamos a 64 encoladas), y ese
    // clog envenena la sesión de bootstrap (0 BOOTSTRAP) starvando los writes críticos
    // (PeriodicInform/ConnReq) → deadlock de gestión. Se borran las tareas de LECTURA pendientes
    // (refreshObject/getParameterValues) antes de encolar las nuevas → la cola queda acotada a un
    // ciclo. NO toca setParameterValues ni reboot (writes de config del operador).
    const pendientes = await this.nbi.listTasks(deviceId).catch(() => []);
    await Promise.all(
      pendientes
        .filter((t) => t.name === 'refreshObject' || t.name === 'getParameterValues')
        .map((t) => this.nbi.deleteTask(t._id).catch(() => {})),
    );
    // ManagementServer: getParameterValues con lista EXPLÍCITA, nunca refreshObject
    // del subárbol completo. ConnectionRequestPassword es write-only — el equipo
    // SIEMPRE la reporta vacía — así que un refreshObject de todo el objeto
    // sincroniza esa cadena vacía sobre el valor real que el ERP ya conoce
    // (TR069_CONNREQ_PASSWORD), rompiendo Connection Request en el siguiente
    // refresh (confirmado en vivo 2026-07-18: funcionaba una vez, se rompía en
    // el refresh siguiente). Se piden solo los campos que sí necesitamos leer.
    await this.nbi.queueTask(deviceId, {
      name: 'getParameterValues',
      parameterNames: [
        'InternetGatewayDevice.ManagementServer.ConnectionRequestURL',
        'InternetGatewayDevice.ManagementServer.ConnectionRequestUsername',
        'InternetGatewayDevice.ManagementServer.URL',
        'InternetGatewayDevice.ManagementServer.PeriodicInformEnable',
        'InternetGatewayDevice.ManagementServer.PeriodicInformInterval',
      ],
    }, true).catch(() => {});
    for (const obj of [
      'InternetGatewayDevice.DeviceInfo',
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration',
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice',
      'InternetGatewayDevice.LANDevice.1.Hosts',
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.AssociatedDevice',
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.AssociatedDevice',
    ]) {
      await this.nbi.queueTask(deviceId, { name: 'refreshObject', objectName: obj }, true).catch(() => {});
    }
    return this.getDetalle(serial);
  }

  // Reboot/factoryReset exigen que el CPE se apague, reinicie y vuelva a informar antes de
  // que GenieACS considere la sesión de Connection Request cerrada — confirmado en vivo
  // (2026-07-18): ~80-90s de punta a punta, por encima de cualquier timeout HTTP razonable
  // para una request síncrona del panel. Se encola SIN esperar el connection_request
  // completo: responde de inmediato, la ejecución real ocurre en segundo plano.
  async reboot(serial: string): Promise<{ ok: boolean; mensaje: string }> {
    const deviceId = await this._deviceIdOrThrow(serial);
    this.nbi.queueTask(deviceId, { name: 'reboot' }, true)
      .then((res) => this.logger.warn(`Reboot ONU ${serial} (device=${deviceId}) status=${res.status}`))
      .catch((err) => this.logger.warn(`Reboot ONU ${serial} (device=${deviceId}) falló: ${err?.message}`));
    return { ok: true, mensaje: `Reboot enviado a la ONU ${serial} — puede tardar 1-2 min en aplicarse.` };
  }

  async factoryReset(serial: string): Promise<{ ok: boolean; mensaje: string }> {
    const deviceId = await this._deviceIdOrThrow(serial);
    this.nbi.queueTask(deviceId, { name: 'factoryReset' }, true)
      .then((res) => this.logger.warn(`FactoryReset ONU ${serial} (device=${deviceId}) status=${res.status}`))
      .catch((err) => this.logger.warn(`FactoryReset ONU ${serial} (device=${deviceId}) falló: ${err?.message}`));

    // La ONU vuelve a bootstrap "en blanco" (pierde WiFi/PPPoE/credenciales). Marca drift
    // para que el watcher de re-inyección la re-aprovisione en cuanto vuelva a informar.
    // Best-effort: si falla el marcado no se revierte el reset ya enviado a la ONU.
    try {
      await this.onuConfig.markPendingReinjectionBySerial(serial);
    } catch (e) {
      this.logger.warn(`No se pudo marcar re-inyección pendiente (${serial}): ${e instanceof Error ? e.message : String(e)}`);
    }

    return { ok: true, mensaje: `Reset de fábrica enviado a la ONU ${serial} — puede tardar 1-2 min en aplicarse.` };
  }

  // ── Edición WiFi / PPPoE (reutiliza el fallback del GenieAcsDriver) ─────────
  // applyExecutionPlan hace UN queueTask(connection_request) POR CAMPO, en serie
  // (hasta 3-4 para WiFi/acceso web) — cada uno puede tardar hasta
  // CONNECTION_REQUEST_TIMEOUT_MS (60s) si el CPE está frío, igual que
  // reboot/factoryReset (confirmado en vivo 2026-07-18: "Aplicar WiFi" daba
  // timeout aunque el cambio SÍ llegaba a aplicarse). Se encola en segundo
  // plano sin bloquear la respuesta HTTP — mismo patrón que reboot/factoryReset.
  private async _applyKeys(
    serial: string,
    writes: Array<{ key: string; value: string | number | boolean | undefined }>,
  ): Promise<{ ok: boolean; applied: number; total: number; fallidas: string[] }> {
    const deviceId = await this._deviceIdOrThrow(serial);
    const runtime = await this.driver.getRuntime(deviceId);
    const profile = runtime ? matchDeviceProfile(runtime) : null;
    if (!profile) throw new NotFoundException(`Sin device-profile para la ONU ${serial} (modelo no soportado).`);
    const pmap = getParameterMap(profile.parameter_map);
    if (!pmap) throw new NotFoundException(`parameter_map "${profile.parameter_map}" no registrado.`);

    const planWrites: ExecutionPlanWrite[] = [];
    for (const w of writes) {
      if (w.value === undefined || w.value === null || w.value === '') continue;
      const candidates = pmap.map[w.key];
      if (candidates?.length) planWrites.push({ key: w.key, candidates, value: w.value });
    }
    if (planWrites.length === 0) return { ok: true, applied: 0, total: 0, fallidas: [] };

    const plan: ExecutionPlan = {
      device: deviceId, profile: `${profile.vendor}_${profile.model}`, writes: planWrites,
      metadata: { revision: 0, generated_at: new Date().toISOString(), generated_by: 'Resolver' },
    };
    this.driver.applyExecutionPlan(plan, pmap)
      .then((res) => this.logger.log(
        `applyExecutionPlan (background) | serial=${serial} device=${deviceId} ok=${res.applied}/${planWrites.length}`,
      ))
      .catch((err) => this.logger.warn(`applyExecutionPlan (background) | serial=${serial} falló: ${err?.message}`));
    return { ok: true, applied: planWrites.length, total: planWrites.length, fallidas: [] };
  }

  setWifi(serial: string, dto: { band: '2.4' | '5'; ssid?: string; password?: string; enabled?: boolean }) {
    const p = dto.band === '5' ? 'wifi5g' : 'wifi';
    return this._applyKeys(serial, [
      { key: `${p}.enable`,   value: dto.enabled },
      { key: `${p}.ssid`,     value: dto.ssid },
      { key: `${p}.password`, value: dto.password },
    ]);
  }

  setPppoe(serial: string, dto: { username?: string; password?: string }) {
    return this._applyKeys(serial, [
      { key: 'internet.username', value: dto.username },
      { key: 'internet.password', value: dto.password },
    ]);
  }

  // Credenciales de acceso web de la ONU (login del equipo): cuenta admin (X_HW_WebUserInfo.2)
  // y usuario (X_HW_WebUserInfo.1). Reutiliza el fallback del driver.
  setAccesoWeb(serial: string, dto: SetAccesoWebDto) {
    return this._applyKeys(serial, [
      { key: 'onu_admin.user',       value: dto.adminUser },
      { key: 'onu_admin.password',   value: dto.adminPassword },
      { key: 'onu_webuser.user',     value: dto.userUser },
      { key: 'onu_webuser.password', value: dto.userPassword },
    ]);
  }
}
