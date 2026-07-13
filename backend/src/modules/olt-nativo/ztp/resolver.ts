import {
  DesiredConfiguration, DeviceProfile, ExecutionPlan, ExecutionPlanWrite, ParameterMap,
} from './ztp.contracts';

// ═══════════════════════════════════════════════════════════════════════════
// Resolver
//
// Traduce una DesiredConfiguration (YA filtrada por el Capability Engine) a un
// ExecutionPlan: la lista de escrituras que el Provision ejecutará mecánicamente.
//
// El Resolver mapea el SHAPE del contrato de negocio (estable) → claves LÓGICAS; el
// ParameterMap (por modelo) mapea clave lógica → rutas TR-069 candidatas. El Resolver
// nunca escribe una ruta TR-069 a mano: todas salen del ParameterMap. Los placeholders
// dinámicos ({ppp}, …) se dejan sin resolver — los resuelve el Provision en runtime.
// ═══════════════════════════════════════════════════════════════════════════
export function resolve(
  deviceId: string,
  desired:  DesiredConfiguration,
  profile:  DeviceProfile,
  pmap:     ParameterMap,
): ExecutionPlan {
  const writes: ExecutionPlanWrite[] = [];

  // Empuja una escritura si hay valor y el modelo mapea esa clave lógica.
  const push = (key: string, value: string | number | boolean | undefined): void => {
    if (value === undefined || value === null || value === '') return;
    const candidates = pmap.map[key];
    if (!candidates?.length) return; // el modelo no expone esta capacidad
    writes.push({ key, candidates, value });
  };

  // WiFi 2.4G
  if (desired.wifi?.enabled) {
    push('wifi.enable',   true);
    push('wifi.ssid',     desired.wifi.ssid);
    push('wifi.password', desired.wifi.password);
    // WiFi 5G (solo si el Capability Engine no la retiró)
    if (desired.wifi.ssid5g) {
      push('wifi5g.enable',   true);
      push('wifi5g.ssid',     desired.wifi.ssid5g);
      push('wifi5g.password', desired.wifi.password5g);
    }
  }

  // Internet — solo PPPoE inyecta credenciales por TR-069 (bridge/dhcp/static no).
  if (desired.internet?.enabled && desired.internet.type === 'pppoe') {
    push('internet.username', desired.internet.username);
    push('internet.password', desired.internet.password);
  }

  // VoIP
  if (desired.voip?.enabled) {
    push('voip.user',      desired.voip.user);
    push('voip.password',  desired.voip.password);
    push('voip.number',    desired.voip.user); // muchos operadores usan el user como DN
    push('voip.registrar', desired.voip.registrar);
    push('voip.proxy',     desired.voip.proxy);
  }

  // Credenciales de acceso de la ONU (cuentas web admin/usuario y CLI root del propio equipo)
  if (desired.onuAdmin?.enabled) {
    push('onu_admin.user',       desired.onuAdmin.user);
    push('onu_admin.password',   desired.onuAdmin.password);
    push('onu_webuser.user',     desired.onuAdmin.webUser);
    push('onu_webuser.password', desired.onuAdmin.webUserPassword);
    push('onu_cli.user',         desired.onuAdmin.cliUser);
    push('onu_cli.password',     desired.onuAdmin.cliPassword);
  }

  // Plano de gestión CWMP — AL FINAL: cambiar las credenciales ConnReq a mitad de sesión
  // podría afectar el connection-request de escrituras posteriores, así que van últimas.
  if (desired.management) {
    push('management.username',     desired.management.acsUsername);
    push('management.password',     desired.management.acsPassword);
    push('management.connreq_user', desired.management.connReqUsername);
    push('management.connreq_pass', desired.management.connReqPassword);
  }

  return {
    device:  deviceId,
    profile: `${profile.vendor}_${profile.model}`,
    writes,
    metadata: {
      revision:     desired.metadata.revision,
      generated_at: new Date().toISOString(),
      generated_by: 'Resolver',
    },
  };
}
