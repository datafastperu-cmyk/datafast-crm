// ─────────────────────────────────────────────────────────────
// Catálogo de canales de aprovisionamiento TR-069 por CPE (ONT/ONU).
//
// Origen (incidente 2026-07-17/18, CNT-2026-000004): se demostró que el
// comando OMCI `ont tr069-server-config` es aceptado por el CLI de la OLT
// Huawei MA5800 pero NO logra sobrescribir de forma confiable la Managed
// Entity "TR069 Management Server" (ME 137, ITU-T G.988) en el ONT Huawei
// EG8145V5 (firmware V5R020C10S195). El ONT permaneció apuntando a un ACS
// anterior (SmartOLT) pese al comando OMCI aceptado sin error, y la
// configuración TR-069 solo convergió al escribirla directamente vía la
// interfaz HTTP de administración del propio equipo (mismo IP de gestión
// TR-069, alcanzable desde la red del backend, no solo LAN del cliente).
//
// IMPORTANTE (feedback del experto consultado): esto NO demuestra que la
// ME137 "nunca se escriba" — solo que la configuración no converge por esa
// vía en este firmware. Por eso el canal HTTP se modela como una CAPACIDAD
// adicional del dispositivo (certificada para esta combinación exacta de
// fabricante/modelo/firmware), no como un "fallback" genérico ni como
// solución universal. Cada fabricante/modelo/firmware tiene su propia
// entrada — un modelo no catalogado NUNCA cae a un intento a ciegas.
//
// RIESGO CONFIRMADO EN VIVO: el panel de administración web del EG8145V5
// se autobloquea tras 3 intentos de login fallidos (observado: LoginTimes=3,
// LockLeftTime=42s). El canal HTTP DEBE aplicarse con circuit breaker
// estricto (ver CpeProvisioningAttempt) — nunca reintentos agresivos.
// ─────────────────────────────────────────────────────────────

export type NombreCanal = 'omci_tr069' | 'http_web';

export type EstadoCertificacion =
  | 'operativo'      // probado end-to-end, seguro para uso automático
  | 'experimental'   // implementado pero no validado en producción a escala
  | 'no_certificado'; // existe en el código pero requiere validación manual antes de habilitarse

export interface CanalCapability {
  canal:          NombreCanal;
  estado:         EstadoCertificacion;
  notas:          string;
  // Si false, el resolver NUNCA invoca este canal automáticamente aunque supports()
  // devuelva true — requiere que un operador lo habilite explícitamente (flag BD/env).
  habilitadoAuto: boolean;
}

export interface CpeModelCapability {
  fabricante:          string;   // 'Huawei', 'ZTE', 'VSOL', ...
  modeloPattern:       RegExp;   // productClass / equipmentId reportado por OMCI/TR-069
  firmwaresValidados:  string[]; // vacío = aplica a cualquier firmware de ese modelo
  canales:             CanalCapability[];
}

// ─────────────────────────────────────────────────────────────
// Catálogo — se agregan entradas a medida que se certifican nuevos
// modelos/canales. Un modelo/fabricante ausente => CPE_MODEL_NOT_SUPPORTED,
// jamás un intento silencioso.
// ─────────────────────────────────────────────────────────────
export const CPE_PROVISIONING_CATALOG: CpeModelCapability[] = [
  {
    fabricante: 'Huawei',
    modeloPattern: /^EG8145V5$/i,
    firmwaresValidados: ['V5R020C10S195'],
    canales: [
      {
        canal: 'omci_tr069',
        estado: 'no_certificado',
        notas: 'Aceptado por CLI/OMCI pero no confirmado que escriba ME137 de forma confiable en este firmware (incidente CNT-2026-000004). Se intenta primero por ser el estándar y por resolver WAN/service-port/GEM, pero su resultado SIEMPRE se verifica — nunca se asume éxito.',
        habilitadoAuto: true,
      },
      {
        canal: 'http_web',
        estado: 'experimental',
        notas: 'Sesión (GetRandCount+BOM strip → login.cgi por cookie → onttoken fresco por página) y Apply (x.URL/x.Username/x.Password/x.ConnectionRequestUsername/x.ConnectionRequestPassword vía set.cgi) validados end-to-end en vivo el 2026-07-18 contra un equipo real (HTTP plano puerto 80, interfaz "ssmp/tr069", no "net_wan_tr069_t.cgi") — POST aceptado Y verificado visualmente en el panel (ACS User Name mostró el valor de prueba tras el Apply). Habilitado temporalmente para prueba controlada de aprovisionamiento real tras reset factory (registro=91f88a42-7410-441f-a4f2-8dd5ee737f82) — revertir a false si no converge o tras confirmar que omci_tr069 basta. El equipo se autobloquea a los 3 intentos de login fallidos (confirmado en vivo). Circuit breaker estricto ya activo: máximo 1 intento por ventana de bloqueo observada, cooldown largo obligatorio antes de reintentar.',
        habilitadoAuto: true, // TEMPORAL: prueba controlada 2026-07-18, revertir tras validar convergencia real
      },
    ],
  },
];

export interface EvaluacionCanales {
  soportado:   boolean;
  motivo?:     string;
  candidatos:  CanalCapability[]; // orden de intento: certificados primero
}

export function evaluarCanalesDisponibles(
  fabricante: string,
  modelo:     string,
  firmware:   string | null,
): EvaluacionCanales {
  const entrada = CPE_PROVISIONING_CATALOG.find(
    (e) => e.fabricante.toLowerCase() === fabricante.toLowerCase() && e.modeloPattern.test(modelo),
  );
  if (!entrada) {
    return { soportado: false, motivo: `Modelo no catalogado: ${fabricante} ${modelo}`, candidatos: [] };
  }
  if (entrada.firmwaresValidados.length > 0 && firmware && !entrada.firmwaresValidados.includes(firmware)) {
    return {
      soportado: true,
      motivo: `Firmware "${firmware}" no está en la lista validada (${entrada.firmwaresValidados.join(', ')}) — se procede con precaución, solo canales certificados.`,
      candidatos: entrada.canales.filter((c) => c.estado === 'operativo' && c.habilitadoAuto),
    };
  }
  // Orden: operativo > experimental > no_certificado. Solo habilitadoAuto entra al resolver automático.
  const rango: Record<EstadoCertificacion, number> = { operativo: 0, experimental: 1, no_certificado: 2 };
  const candidatos = [...entrada.canales]
    .filter((c) => c.habilitadoAuto)
    .sort((a, b) => rango[a.estado] - rango[b.estado]);
  return { soportado: true, candidatos };
}
