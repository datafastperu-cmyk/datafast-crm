import { Injectable, Logger } from '@nestjs/common';
import { Tr069GenieacsClient } from '../../tr069/tr069-genieacs.client';
import { ExecutionPlan, ParameterMap } from './ztp.contracts';
import { DeviceRuntime } from './registry';

// ═══════════════════════════════════════════════════════════════════════════
// GenieAcsDriver — capa que habla NBI con GenieACS para aplicar un ExecutionPlan.
//
// Responsabilidades RUNTIME (que el ERP no puede hacer porque no ve el árbol vivo):
//   - leer el Runtime del device (modelo/firmware) para elegir el DeviceProfile,
//   - resolver placeholders dinámicos ({ppp}) por descubrimiento en el árbol,
//   - aplicar las escrituras (setParameterValues) con ConnectionRequest,
//   - marcar el device con un Tag.
//
// El fallback por priority-list completo (probar 2ª/3ª ruta si la 1ª no aplica) es un
// comportamiento de sesión que corresponde a un Provision GenieACS; aquí se aplica la
// ruta primaria de cada write (la validada para el modelo). Ampliar en Inc.2b (Provision JS).
// ═══════════════════════════════════════════════════════════════════════════
@Injectable()
export class GenieAcsDriver {
  private readonly logger = new Logger(GenieAcsDriver.name);

  constructor(private readonly nbi: Tr069GenieacsClient) {}

  isReady(): boolean {
    return this.nbi.isConfigured();
  }

  /** Busca el device en GenieACS por el Serial Number (= SN GPON de la ONU). */
  async findDeviceIdBySerial(serial: string): Promise<string | null> {
    const rows = await this.nbi.listDevices({ '_deviceId._SerialNumber': serial }, '_id');
    return rows[0]?._id ?? null;
  }

  /** Runtime del device (para resolver el DeviceProfile). */
  async getRuntime(deviceId: string): Promise<DeviceRuntime | null> {
    const dev = await this.nbi.getDevice(deviceId);
    if (!dev) return null;
    const did  = dev._deviceId ?? {};
    const info = dev.InternetGatewayDevice?.DeviceInfo ?? {};
    return {
      manufacturer:    did._Manufacturer,
      productClass:    did._ProductClass,
      modelName:       info.ModelName?._value,
      softwareVersion: info.SoftwareVersion?._value,
      hardwareVersion: info.HardwareVersion?._value,
    };
  }

  /** Navega el doc del device por ruta punteada (ignora claves internas `_`). */
  private _node(dev: any, dotted: string): any {
    let n = dev;
    for (const seg of dotted.split('.')) {
      if (n == null || typeof n !== 'object') return null;
      n = n[seg];
    }
    return n;
  }

  /** Resuelve los placeholders dinámicos del ParameterMap (p.ej. {ppp}) → índice real. */
  async resolveDiscovery(deviceId: string, pmap: ParameterMap): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    if (!pmap.discovery) return out;
    for (const [ph, d] of Object.entries(pmap.discovery)) {
      // Refrescar el contenedor para poblar sus hijos en el árbol de GenieACS.
      await this.nbi.queueTask(deviceId, { name: 'refreshObject', objectName: d.object }, true).catch(() => {});
      const dev = await this.nbi.getDevice(deviceId);
      const container = this._node(dev, d.object);
      if (container && typeof container === 'object') {
        for (const k of Object.keys(container)) {
          if (k.startsWith('_')) continue;
          const child = container[k];
          if (child && typeof child === 'object' && Object.prototype.hasOwnProperty.call(child, d.contains)) {
            out[ph] = k;
            break;
          }
        }
      }
    }
    return out;
  }

  /** Aplica el ExecutionPlan al device por NBI. Devuelve resumen (aplicadas/omitidas). */
  async applyExecutionPlan(
    plan: ExecutionPlan,
    pmap: ParameterMap,
  ): Promise<{ applied: number; skipped: string[]; queued: boolean }> {
    const disc = await this.resolveDiscovery(plan.device, pmap);

    const paramValues: Array<[string, unknown, string?]> = [];
    const skipped: string[] = [];

    for (const w of plan.writes) {
      // Ruta primaria del write; sustituir placeholders {name}.
      let unresolved = false;
      const path = w.candidates[0].replace(/\{(\w+)\}/g, (_m, name: string) => {
        const v = disc[name];
        if (v == null) { unresolved = true; return `{${name}}`; }
        return v;
      });
      if (unresolved) { skipped.push(w.key); continue; }
      paramValues.push([path, w.value]);
    }

    let queued = false;
    if (paramValues.length) {
      const res = await this.nbi.queueTask(
        plan.device, { name: 'setParameterValues', parameterValues: paramValues }, true,
      );
      queued = res.status === 200 || res.status === 202;
    }
    // Tag idempotente (guard/traza del pipeline).
    await this.nbi.addTag(plan.device, 'ProvisionedByErp').catch(() => {});

    this.logger.log(
      `applyExecutionPlan | device=${plan.device} aplicadas=${paramValues.length} ` +
      `omitidas=[${skipped.join(',')}] queued=${queued}`,
    );
    return { applied: paramValues.length, skipped, queued };
  }
}
