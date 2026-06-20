import { Injectable, Logger } from '@nestjs/common';

// ─────────────────────────────────────────────────────────────────────────
// CircuitBreakerRegistry
//
// Protege contra cascadas de timeouts cuando un proveedor de mensajería
// cae. Sin CB: 500 mensajes × 15s timeout × 2 intentos = 250+ minutos
// bloqueados. Con CB: tras 5 fallos consecutivos, las llamadas se cortocircuitan
// y el queue drena en segundos.
//
// Estado por clave "{empresaId}:{proveedor}" (in-memory, local al proceso):
//
//   CLOSED   → operación normal; fallos consecutivos incrementan el contador
//   OPEN     → proveedor caído; fast-fail inmediato sin hacer HTTP
//   HALF_OPEN → cooldown expirado; se permite UN probe para verificar recuperación
//
// Transiciones:
//   CLOSED → OPEN      : failureThreshold fallos consecutivos
//   OPEN   → HALF_OPEN : cooldownMs transcurrido + sin probe en vuelo
//   HALF_OPEN → CLOSED : probe exitoso
//   HALF_OPEN → OPEN   : probe fallido (reset del timer de cooldown)
// ─────────────────────────────────────────────────────────────────────────

type CbState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface BreakerEntry {
  state:        CbState;
  failures:     number;  // fallos consecutivos desde el último éxito
  openedAt:     number;  // Date.now() cuando pasó a OPEN
  halfOpenLock: boolean; // true mientras un probe está en vuelo
}

export interface CbStatus {
  state:         CbState;
  failures:      number;
  openedAgoSec?: number;
}

@Injectable()
export class CircuitBreakerRegistry {
  private readonly logger   = new Logger(CircuitBreakerRegistry.name);
  private readonly breakers = new Map<string, BreakerEntry>();

  // Parámetros conservadores para ISP con proveedores de mensajería
  private readonly FAILURE_THRESHOLD = 5;       // fallos para abrir
  private readonly COOLDOWN_MS       = 60_000;  // 60 s en OPEN antes del probe

  // ── Verificar si se puede proceder con la llamada al proveedor ────────
  // Retorna true → la llamada debe hacerse
  // Retorna false → fast-fail (proveedor aún caído)
  canProceed(key: string): boolean {
    const b = this.getOrCreate(key);

    if (b.state === 'CLOSED') return true;

    if (b.state === 'OPEN') {
      const elapsed = Date.now() - b.openedAt;
      if (elapsed >= this.COOLDOWN_MS && !b.halfOpenLock) {
        b.state       = 'HALF_OPEN';
        b.halfOpenLock = true;
        this.logger.log(`[CB] '${key}': OPEN → HALF_OPEN (probe autorizado tras ${Math.round(elapsed / 1000)}s)`);
        return true;
      }
      return false;
    }

    // HALF_OPEN: solo un probe a la vez; el resto fast-fail hasta resolver
    return false;
  }

  // ── Registrar éxito de la llamada al proveedor ────────────────────────
  onSuccess(key: string): void {
    const b = this.getOrCreate(key);
    if (b.state === 'HALF_OPEN') {
      this.logger.log(`[CB] '${key}': HALF_OPEN → CLOSED (probe exitoso)`);
    }
    b.state        = 'CLOSED';
    b.failures     = 0;
    b.halfOpenLock = false;
  }

  // ── Registrar fallo de la llamada al proveedor ────────────────────────
  // Solo llamar cuando el fallo es del proveedor (timeout, 5xx, red);
  // no llamar para fallos de configuración/plantilla propios del gateway.
  onFailure(key: string): void {
    const b = this.getOrCreate(key);
    b.failures++;
    b.halfOpenLock = false;

    if (b.state === 'HALF_OPEN') {
      b.state    = 'OPEN';
      b.openedAt = Date.now();
      this.logger.warn(`[CB] '${key}': HALF_OPEN → OPEN (probe fallido, cooldown reiniciado)`);
      return;
    }

    if (b.state === 'CLOSED' && b.failures >= this.FAILURE_THRESHOLD) {
      b.state    = 'OPEN';
      b.openedAt = Date.now();
      this.logger.warn(
        `[CB] '${key}': CLOSED → OPEN ` +
        `(${b.failures} fallos consecutivos — proveedor considerado caído)`,
      );
    }
  }

  // ── Reset manual (útil cuando el admin reactiva el proveedor) ─────────
  reset(key: string): void {
    const b = this.breakers.get(key);
    if (b) {
      b.state        = 'CLOSED';
      b.failures     = 0;
      b.openedAt     = 0;
      b.halfOpenLock = false;
      this.logger.log(`[CB] '${key}': reset manual → CLOSED`);
    }
  }

  resetAll(): void {
    for (const key of this.breakers.keys()) this.reset(key);
  }

  // ── Snapshot del estado para endpoints de diagnóstico ─────────────────
  getStatus(): Record<string, CbStatus> {
    const result: Record<string, CbStatus> = {};
    for (const [key, b] of this.breakers) {
      result[key] = {
        state:    b.state,
        failures: b.failures,
        ...(b.state !== 'CLOSED'
          ? { openedAgoSec: Math.round((Date.now() - b.openedAt) / 1000) }
          : {}),
      };
    }
    return result;
  }

  private getOrCreate(key: string): BreakerEntry {
    if (!this.breakers.has(key)) {
      this.breakers.set(key, {
        state: 'CLOSED', failures: 0, openedAt: 0, halfOpenLock: false,
      });
    }
    return this.breakers.get(key)!;
  }
}
