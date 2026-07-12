import { DesiredConfiguration, DeviceProfile } from './ztp.contracts';

// ═══════════════════════════════════════════════════════════════════════════
// Capability Engine
//
// Recibe la DesiredConfiguration (negocio) y el DeviceProfile del modelo, y ELIMINA
// lo que el modelo no soporta ANTES de que el Resolver traduzca a rutas TR-069.
// Así el Resolver/Provision nunca intentan escribir un servicio inexistente en la ONU.
//
// Regla: no muta la entrada; devuelve una copia filtrada.
// ═══════════════════════════════════════════════════════════════════════════
export function filterByCapabilities(
  desired: DesiredConfiguration,
  profile: DeviceProfile,
): DesiredConfiguration {
  const caps = profile.capabilities;
  // Copia profunda segura (DesiredConfiguration es JSON-serializable).
  const out: DesiredConfiguration = JSON.parse(JSON.stringify(desired));

  // WiFi 2.4G
  if (out.wifi) {
    if (!caps.wifi_2g) out.wifi.enabled = false;
    // WiFi 5G: si el modelo no lo soporta, se retira la banda de 5G.
    if (!caps.wifi_5g) {
      delete out.wifi.ssid5g;
      delete out.wifi.password5g;
    }
  }

  // Internet: si pide PPPoE y el modelo no lo soporta (p.ej. solo bridge), se deshabilita.
  if (out.internet?.enabled && out.internet.type === 'pppoe' && !caps.pppoe) {
    out.internet.enabled = false;
  }

  // VoIP
  if (out.voip?.enabled && !caps.voip) {
    out.voip.enabled = false;
  }

  // Credenciales de acceso admin de la ONU
  if (out.onuAdmin?.enabled && !caps.onu_admin_credentials) {
    out.onuAdmin.enabled = false;
  }

  return out;
}
