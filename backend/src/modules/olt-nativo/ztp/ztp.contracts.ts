// ═══════════════════════════════════════════════════════════════════════════
// ZTP — Contratos congelados (Incremento 0)
//
// Arquitectura capability-based aprobada por revisión experta (2026-07-12):
//
//   ERP → DesiredConfiguration → Resolver → ExecutionPlan → Provision → TR-069
//
// Regla de oro: el ERP JAMÁS conoce un parámetro TR-069 (ni real ni virtual). El ERP
// solo produce `DesiredConfiguration` (negocio). El Resolver (usa DeviceProfile +
// ParameterMap) traduce a un `ExecutionPlan` (rutas). El Provision solo ejecuta el plan.
//
// Estos 4 tipos son CONTRATOS: cambiarlos tras empezar a codificar es caro. Congelados.
// ═══════════════════════════════════════════════════════════════════════════

// ── Contrato 1: DesiredConfiguration ───────────────────────────────────────
// Lo que el ERP quiere para la ONU, en términos de NEGOCIO. Sin rutas TR-069.
// El Capability Engine filtra los servicios que el modelo no soporta antes del Resolver.
export interface DesiredConfiguration {
  /** Versión del ESQUEMA de este contrato (no de la config del cliente). */
  schemaVersion: 1;
  metadata: {
    /** Revisión de la config del cliente — sube en cada cambio (base de reconciliación). */
    revision:     number;
    generated_at: string;   // ISO-8601
    generated_by: string;   // 'ERP'
  };
  wifi?: {
    enabled:   boolean;
    ssid:      string;
    password:  string;
    ssid5g?:   string;
    password5g?: string;
  };
  internet?: {
    enabled:   boolean;
    type:      'pppoe' | 'dhcp' | 'static' | 'bridge';
    username?: string;
    password?: string;
    vlan?:     number;
  };
  voip?: {
    enabled:    boolean;
    user?:      string;
    password?:  string;
    registrar?: string;
    proxy?:     string;
  };
  /** Credenciales de acceso de la propia ONU (login web/CLI del equipo). */
  onuAdmin?: {
    enabled:   boolean;
    /** Cuenta ADMIN web (telecomadmin). */
    user?:     string;
    password?: string;
    /** Cuenta USUARIO web (limitada). */
    webUser?:         string;
    webUserPassword?: string;
    /** Cuenta CLI/Telnet root. */
    cliUser?:     string;
    cliPassword?: string;
  };
}

// ── Contrato 2: DeviceProfile ──────────────────────────────────────────────
// Describe un modelo por CAPACIDADES + qué parameter_map y provision usar.
// Se resuelve a partir del Runtime que reporta GenieACS (Manufacturer/ModelName/…).
// Varios firmwares del mismo modelo comparten el MISMO parameter_map → no duplicar.
export interface DeviceProfile {
  vendor:   string;   // 'Huawei'
  model:    string;   // 'EG8145V5'
  firmware?: string;  // 'V5R020C10S195' (informativo; el map se comparte entre firmwares)
  /** Criterios para casar este perfil contra el Runtime de GenieACS. */
  match: {
    manufacturer?:    string;
    modelName?:       string;
    productClass?:    string;
    softwareVersion?: string;  // prefijo/patrón
    hardwareVersion?: string;
  };
  bootstrap_method: 'DHCP_OPTION_43' | 'OMCI' | 'CONFIG_FILE' | 'MANUAL';
  parameter_map:    string;    // nombre de archivo versionado: 'huawei_igd_v1.json'
  provision:        string;    // provision GenieACS a usar: 'default_internet'
  capabilities: {
    pppoe?:            boolean;
    wifi_2g?:          boolean;
    wifi_5g?:          boolean;
    vlan_per_service?: boolean;
    voip?:             boolean;
    iptv_multicast?:   boolean;
    /** ¿El modelo permite gestionar sus credenciales de acceso admin por TR-069? */
    onu_admin_credentials?: boolean;
  };
}

// ── Contrato 3: ParameterMap ───────────────────────────────────────────────
// Traduce claves LÓGICAS (wifi.ssid, internet.username…) a listas priorizadas de rutas
// TR-069 candidatas. El Provision itera cada lista y usa la primera ruta que aplique
// (fallback como PRIORITY LIST, no if/else).
//
// Placeholders dinámicos `{name}` en las rutas se resuelven en runtime vía `discovery`
// (p.ej. el índice real de WANConnectionDevice que contiene WANPPPConnection).
export interface ParameterMap {
  data_model: 'InternetGatewayDevice' | 'Device';   // TR-098 vs TR-181
  /** clave lógica → rutas candidatas en orden de prioridad. */
  map: Record<string, string[]>;
  /** name del placeholder → cómo descubrir su índice real en el árbol vivo. */
  discovery?: Record<string, {
    /** objeto contenedor a refrescar/recorrer. */
    object: string;
    /** sub-objeto cuya presencia marca el índice correcto (p.ej. 'WANPPPConnection'). */
    contains: string;
  }>;
}

// ── Contrato 4: ExecutionPlan ──────────────────────────────────────────────
// Salida del Resolver. Lista de escrituras que el Provision ejecuta mecánicamente.
// Cada escritura lleva la lista de rutas candidatas (con placeholders sin resolver);
// el Provision resuelve placeholders (discovery) e itera candidatas hasta que una aplique.
export interface ExecutionPlanWrite {
  /** clave lógica (para logging/auditoría; el Provision no interpreta negocio). */
  key:        string;
  /** rutas TR-069 candidatas en orden de prioridad (pueden traer placeholders {name}). */
  candidates: string[];
  value:      string | number | boolean;
}

export interface ExecutionPlan {
  device:  string;   // _id del device en GenieACS
  profile: string;   // '<vendor>_<model>' del DeviceProfile usado
  writes:  ExecutionPlanWrite[];
  metadata: {
    revision:     number;   // = DesiredConfiguration.metadata.revision (traza)
    generated_at: string;
    generated_by: string;   // 'Resolver'
  };
}
