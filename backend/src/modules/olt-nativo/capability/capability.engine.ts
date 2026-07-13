// ═══════════════════════════════════════════════════════════════════════════
// Capability Engine genérico — Incremento 3
//
// Generaliza el patrón que ya existe en ztp/capability.engine.ts (filtra una
// configuración deseada según lo que un perfil de dispositivo soporta) para
// que lo puedan usar dominios distintos a ZTP/ONU sin acoplarse entre sí.
//
// ztp/capability.engine.ts NO se toca: sus tipos (DesiredConfiguration,
// DeviceProfile) son un contrato congelado de una revisión experta previa
// (ver ztp/ztp.contracts.ts). Este motor es un primitivo nuevo y neutral —
// ZTP puede migrar a él más adelante si se decide deliberadamente, nunca
// por arrastre.
//
// Regla: no muta la entrada; devuelve una copia filtrada. Cada CapabilityRule
// es una función pura (desired, capabilities) → desired filtrado.
// ═══════════════════════════════════════════════════════════════════════════

export type CapabilityRule<TDesired, TCapabilities> = (
  desired: TDesired,
  capabilities: TCapabilities,
) => TDesired;

export function applyCapabilityRules<TDesired, TCapabilities>(
  desired: TDesired,
  capabilities: TCapabilities,
  rules: Array<CapabilityRule<TDesired, TCapabilities>>,
): TDesired {
  // Copia profunda segura — requiere que TDesired sea JSON-serializable,
  // misma precondición que ztp/capability.engine.ts.
  let out = JSON.parse(JSON.stringify(desired)) as TDesired;
  for (const rule of rules) {
    out = rule(out, capabilities);
  }
  return out;
}
