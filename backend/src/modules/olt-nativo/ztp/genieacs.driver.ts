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

  /**
   * Variantes del SN para casar contra GenieACS. Los OLTs Huawei reportan el SN en forma
   * LEGIBLE ("HWTC16A6BAAC" = 4 letras de vendor + 8 hex), pero la ONU informa a GenieACS
   * en forma HEX ("4857544316A6BAAC" = ASCII-hex del vendor + los 8 hex). Se prueban ambas.
   */
  private _snVariants(serial: string): string[] {
    const s = (serial ?? '').trim();
    const out = new Set<string>();
    if (!s) return [];
    out.add(s);
    // Legible (4 letras + 8 hex) → hex
    const mLegible = /^([A-Za-z]{4})([0-9A-Fa-f]{8})$/.exec(s);
    if (mLegible) {
      const hexVendor = Array.from(mLegible[1]).map((ch) => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('');
      out.add((hexVendor + mLegible[2]).toUpperCase());
    }
    // Hex (16 hex) → legible, solo si los primeros 8 hex decodifican a 4 letras ASCII
    const mHex = /^([0-9A-Fa-f]{8})([0-9A-Fa-f]{8})$/.exec(s);
    if (mHex) {
      let vendor = '';
      for (let i = 0; i < 8; i += 2) vendor += String.fromCharCode(parseInt(mHex[1].slice(i, i + 2), 16));
      if (/^[A-Za-z]{4}$/.test(vendor)) out.add((vendor + mHex[2]).toUpperCase());
    }
    return [...out];
  }

  /** Busca el device en GenieACS por el Serial Number (= SN GPON de la ONU), tolerando el
   *  desajuste legible↔hex entre el registro de la OLT y lo que informa la ONU. */
  async findDeviceIdBySerial(serial: string): Promise<string | null> {
    const variants = this._snVariants(serial);
    if (variants.length === 0) return null;
    const query = variants.length === 1
      ? { '_deviceId._SerialNumber': variants[0] }
      : { '_deviceId._SerialNumber': { $in: variants } };
    const rows = await this.nbi.listDevices(query, '_id');
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

  private _sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Sustituye placeholders {name} en una ruta usando el mapa de descubrimiento. */
  private _fill(path: string, disc: Record<string, string>): string | null {
    let bad = false;
    const out = path.replace(/\{(\w+)\}/g, (_m, name: string) => {
      const v = disc[name];
      if (v == null) { bad = true; return `{${name}}`; }
      return v;
    });
    return bad ? null : out;
  }

  /**
   * Aplica el ExecutionPlan por NBI, POR ESCRITURA, iterando la priority-list de rutas
   * candidatas: prueba la 1ª; si genera un fault CWMP (p.ej. `cwmp.9003 Invalid arguments`,
   * verificado en EG8145V5 con KeyPassphrase), borra el fault+task y prueba la siguiente.
   * Detección de fault por canal `task_<id>` (comportamiento observado en GenieACS).
   */
  async applyExecutionPlan(
    plan: ExecutionPlan,
    pmap: ParameterMap,
  ): Promise<{
    applied: number;
    results: Array<{ key: string; ok: boolean; path?: string; fault?: string; reason?: string }>;
  }> {
    const disc = await this.resolveDiscovery(plan.device, pmap);
    const results: Array<{ key: string; ok: boolean; path?: string; fault?: string; reason?: string }> = [];

    for (const w of plan.writes) {
      const candidates = w.candidates
        .map((c) => this._fill(c, disc))
        .filter((c): c is string => c !== null);

      if (candidates.length === 0) {
        results.push({ key: w.key, ok: false, reason: 'placeholder-no-resuelto' });
        continue;
      }

      let done = false;
      let lastFault: string | undefined;
      for (const path of candidates) {
        const res = await this.nbi.queueTask(
          plan.device, { name: 'setParameterValues', parameterValues: [[path, w.value]] }, true,
        );
        const taskId = (res.body as { _id?: string })?._id;

        // Sin taskId persistido = aplicada en sesión sin fault → éxito.
        if (!taskId) { results.push({ key: w.key, ok: true, path }); done = true; break; }

        // Dar un momento a la sesión y comprobar fault del canal de la task.
        await this._sleep(1500);
        const faults = await this.nbi.getFaults(plan.device, `task_${taskId}`).catch(() => []);
        if (faults.length === 0) {
          // Sin fault: aplicada (o encolada pendiente sin error) → aceptada.
          results.push({ key: w.key, ok: true, path });
          done = true; break;
        }
        // Fault en esta candidata: limpiar y probar la siguiente.
        lastFault = faults[0].code ?? faults[0].message;
        await this.nbi.deleteFault(faults[0]._id).catch(() => {});
        await this.nbi.deleteTask(taskId).catch(() => {});
      }

      if (!done) results.push({ key: w.key, ok: false, fault: lastFault, reason: 'todas-las-rutas-fallaron' });
    }

    const applied = results.filter((r) => r.ok).length;
    await this.nbi.addTag(plan.device, applied === plan.writes.length ? 'Provisioned' : 'ProvisionFailed').catch(() => {});

    this.logger.log(
      `applyExecutionPlan | device=${plan.device} ok=${applied}/${plan.writes.length} ` +
      results.map((r) => `${r.key}:${r.ok ? 'ok' : (r.fault ?? r.reason)}`).join(' '),
    );
    return { applied, results };
  }
}
