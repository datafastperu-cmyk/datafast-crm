import { DeviceProfile, ParameterMap } from './ztp.contracts';
import { HUAWEI_EG8145V5 } from './device-profiles/huawei-eg8145v5';
import { HUAWEI_IGD_V1 }   from './parameter-maps/huawei-igd-v1';

// ═══════════════════════════════════════════════════════════════════════════
// Registry ZTP — device_profiles + parameter_maps versionados junto al código.
//
// Agregar un fabricante/modelo = agregar su módulo de datos aquí (sin tocar lógica).
// Se cargan como módulos TS (tipados, siempre presentes en dist/).
// ═══════════════════════════════════════════════════════════════════════════

/** Runtime que reporta GenieACS (InternetGatewayDevice.DeviceInfo.*). */
export interface DeviceRuntime {
  manufacturer?:    string;
  modelName?:       string;
  productClass?:    string;
  softwareVersion?: string;
  hardwareVersion?: string;
}

const PROFILES: DeviceProfile[] = [
  HUAWEI_EG8145V5,
];

const PARAMETER_MAPS: Record<string, ParameterMap> = {
  huawei_igd_v1: HUAWEI_IGD_V1,
};

/**
 * Resuelve el DeviceProfile a partir del Runtime. Exige que case al menos modelName o
 * productClass (para no sobre-emparejar). softwareVersion casa por prefijo.
 */
export function matchDeviceProfile(rt: DeviceRuntime): DeviceProfile | null {
  for (const p of PROFILES) {
    const m = p.match;
    const ok =
      (!m.manufacturer    || m.manufacturer    === rt.manufacturer) &&
      (!m.modelName       || m.modelName       === rt.modelName) &&
      (!m.productClass    || m.productClass    === rt.productClass) &&
      (!m.hardwareVersion || m.hardwareVersion === rt.hardwareVersion) &&
      (!m.softwareVersion || (rt.softwareVersion ?? '').startsWith(m.softwareVersion));
    // Requiere una señal fuerte de identidad (modelo o product-class).
    if (ok && (m.modelName || m.productClass)) return p;
  }
  return null;
}

export function getParameterMap(name: string): ParameterMap | null {
  return PARAMETER_MAPS[name] ?? null;
}
