import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHmac } from 'crypto';
import { ModuleHealthService } from '../../../common/services/module-health.service';

// ═══════════════════════════════════════════════════════════════════════════
// CwmpAuthService — deriva la contraseña CWMP determinista por dispositivo.
//
// Debe producir EXACTAMENTE el mismo valor que la extensión GenieACS
// /opt/genieacs/ext/erpauth.js (función derive):
//   HMAC-SHA256(CWMP_AUTH_SECRET, serial) → base64 → quita no-alfanuméricos → 16 chars.
//
// La ONU se autentica ante GenieACS con:
//   ManagementServer.Username = <serial hex que ve GenieACS (DeviceID.SerialNumber)>
//   ManagementServer.Password = derive(serial)
// La expresión cwmp.auth activa es:
//   Tags.AuthEnforced IS NULL OR AUTH(DeviceID.SerialNumber, EXT("erpauth","pass",DeviceID.SerialNumber))
// → ONU nueva (sin tag) onboardea zero-touch; ONU provisionada (con tag) exige su HMAC.
//
// PATRÓN DEGRADADO (obligatorio): si CWMP_AUTH_SECRET no está seteado, el módulo
// arranca igual pero `enabled=false` → el provisioning NO exige auth (mantiene
// zero-touch puro). Nunca relanza fuera del onModuleInit.
// ═══════════════════════════════════════════════════════════════════════════
@Injectable()
export class CwmpAuthService implements OnModuleInit {
  private readonly logger = new Logger(CwmpAuthService.name);

  constructor(private readonly moduleHealth: ModuleHealthService) {}

  // Lazy: se lee en tiempo de llamada (portabilidad multi-VPS), nunca como
  // constante de módulo (ConfigModule aún no cargó el .env al importar).
  private get secret(): string {
    return process.env.CWMP_AUTH_SECRET ?? '';
  }

  /** true si hay secreto configurado → el HMAC por dispositivo es derivable. */
  isEnabled(): boolean {
    return this.secret.length > 0;
  }

  /**
   * ¿Se ENDURECE la auth CWMP por dispositivo (tag `AuthEnforced`)?
   *
   * Por defecto NO. Decisión de arquitectura 2026-07-28, tras el análisis de causa raíz:
   * `ManagementServer.Password` es write-only en la EG8145V5 — no existe forma de leer el
   * valor que quedó en la ONU. Un mecanismo de seguridad cuyo estado no se puede observar
   * contradice frontalmente la regla VIO ("aceptado ≠ materializado"), y ya costó caro: si
   * el tag queda puesto sin que el HMAC viva de verdad en la ONU (p.ej. tras un factory
   * reset, que borra las credenciales pero no el tag), GenieACS rechaza su Inform y la
   * gestión remota muere en un deadlock permanente — incidente del 2026-07-24, días de
   * gestión perdida, diagnosticado con tcpdump.
   *
   * El aislamiento de la VLAN de gestión 1600 + el connection-request con credenciales del
   * ERP sí son verificables, y son la defensa que se conserva.
   *
   * `CWMP_AUTH_ENFORCE=true` restaura el endurecimiento para instalaciones donde el
   * firmware SÍ materialice el write de forma comprobable.
   */
  isEnforcementEnabled(): boolean {
    return this.isEnabled() && String(process.env.CWMP_AUTH_ENFORCE).toLowerCase() === 'true';
  }

  onModuleInit(): void {
    if (this.isEnabled()) {
      this.moduleHealth.registrar('cwmp-auth', 'ok');
    } else {
      this.moduleHealth.registrar(
        'cwmp-auth', 'degraded',
        'CWMP_AUTH_SECRET no configurado — auth CWMP por-dispositivo deshabilitada (zero-touch sin endurecer).',
      );
    }
  }

  /**
   * Deriva la contraseña CWMP para un serial. DEBE coincidir con erpauth.js.
   * Retorna null si no hay secreto (degradado) o serial vacío.
   */
  derive(serial: string): string | null {
    const s = (serial ?? '').trim();
    const secret = this.secret;
    if (!s || !secret) return null;
    return createHmac('sha256', secret)
      .update(s)
      .digest('base64')
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 16);
  }
}
