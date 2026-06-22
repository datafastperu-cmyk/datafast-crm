import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository }  from '@nestjs/typeorm';
import { Repository }        from 'typeorm';

import {
  CircuitEstado,
  OltProveedorConfig,
} from '../entities/olt-proveedor-config.entity';

// ─────────────────────────────────────────────────────────────
// CircuitBreakerService
//
// Gestiona el estado del circuit breaker por cada par
// (olt_id, tipo_proveedor) de forma independiente.
//
// Estados y transiciones:
//
//   CLOSED ──[≥ FAILURE_THRESHOLD fallos]──→ OPEN
//     ↑                                        │
//     └──[éxito en HALF_OPEN]── HALF_OPEN ←──┘
//                                (tras RECOVERY_TIMEOUT)
//
// Persistencia: olt_proveedor_config.circuit_estado / circuit_fallas /
//               circuit_abierto_hasta (sobrevive reinicios).
//
// Cache en memoria: evita un SELECT por cada request.
//   TTL = 10 s. Se invalida en toda escritura de estado.
// ─────────────────────────────────────────────────────────────

interface CacheEntry {
  estado:       CircuitEstado;
  fallas:       number;
  abiertoHasta: Date | null;
  expiresAt:    number;   // Date.now() + TTL
}

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);

  // Parámetros del circuit breaker — constantes del sistema.
  private readonly FAILURE_THRESHOLD   = 3;           // fallos consecutivos para abrir
  private readonly RECOVERY_TIMEOUT_MS = 120_000;     // 2 min en OPEN antes de HALF_OPEN
  private readonly CACHE_TTL_MS        = 10_000;      // 10 s de vida del cache en memoria

  // Clave: OltProveedorConfig.id (UUID)
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @InjectRepository(OltProveedorConfig)
    private readonly repo: Repository<OltProveedorConfig>,
  ) {}

  // ────────────────────────────────────────────────────────────
  // canAttempt
  // Retorna true si el proveedor puede recibir un intento ahora.
  // Efectos secundarios: transiciona OPEN → HALF_OPEN cuando el
  // recovery timeout ya pasó.
  // ────────────────────────────────────────────────────────────
  async canAttempt(config: OltProveedorConfig): Promise<boolean> {
    const state = await this.readState(config.id);

    if (state.estado === 'closed' || state.estado === 'half_open') {
      return true;
    }

    // OPEN: verificar si el timeout de recuperación ya expiró
    if (state.abiertoHasta && state.abiertoHasta <= new Date()) {
      await this.setEstado(config.id, 'half_open', { circuitAbiertoHasta: null });
      this.logger.log(
        `Circuit → HALF_OPEN | olt=${config.oltId} proveedor=${config.tipo}`,
      );
      return true;
    }

    return false;
  }

  // ────────────────────────────────────────────────────────────
  // recordFailure
  // Registra un fallo del proveedor.
  // Si los fallos acumulados alcanzan el umbral (o el circuito
  // estaba en HALF_OPEN), abre el circuito.
  // ────────────────────────────────────────────────────────────
  async recordFailure(config: OltProveedorConfig): Promise<void> {
    const state = await this.readState(config.id);

    // HALF_OPEN: el intento de prueba falló → volver a OPEN de inmediato
    if (state.estado === 'half_open') {
      const abiertoHasta = new Date(Date.now() + this.RECOVERY_TIMEOUT_MS);
      await this.setEstado(config.id, 'open', {
        circuitFallas:       0,
        circuitAbiertoHasta: abiertoHasta,
      });
      this.logger.warn(
        `Circuit → OPEN (probe falló) | olt=${config.oltId} proveedor=${config.tipo} ` +
        `hasta=${abiertoHasta.toISOString()}`,
      );
      return;
    }

    // CLOSED o OPEN: incrementar contador atómicamente
    await this.repo.increment({ id: config.id }, 'circuitFallas', 1);
    this.cache.delete(config.id);   // forzar re-lectura

    const fresh = await this.readState(config.id);

    if (fresh.fallas >= this.FAILURE_THRESHOLD) {
      const abiertoHasta = new Date(Date.now() + this.RECOVERY_TIMEOUT_MS);
      await this.setEstado(config.id, 'open', {
        circuitFallas:       0,
        circuitAbiertoHasta: abiertoHasta,
      });
      this.logger.warn(
        `Circuit → OPEN (${this.FAILURE_THRESHOLD} fallos) | olt=${config.oltId} ` +
        `proveedor=${config.tipo} hasta=${abiertoHasta.toISOString()}`,
      );
    }
  }

  // ────────────────────────────────────────────────────────────
  // recordSuccess
  // Registra un éxito del proveedor.
  // Si estaba HALF_OPEN, cierra el circuito.
  // Siempre resetea el contador de fallos.
  // ────────────────────────────────────────────────────────────
  async recordSuccess(config: OltProveedorConfig): Promise<void> {
    const state = await this.readState(config.id);

    if (state.estado === 'half_open') {
      await this.setEstado(config.id, 'closed', {
        circuitFallas:       0,
        circuitAbiertoHasta: null,
      });
      this.logger.log(
        `Circuit → CLOSED (probe exitoso) | olt=${config.oltId} proveedor=${config.tipo}`,
      );
      return;
    }

    // CLOSED: si había fallos acumulados, resetearlos
    if (state.fallas > 0) {
      await this.repo.update(config.id, { circuitFallas: 0 });
      this.cache.delete(config.id);
    }
  }

  // ────────────────────────────────────────────────────────────
  // resetForzado
  // Permite a un operador resetear manualmente un circuito OPEN.
  // Útil desde el panel de administración.
  // ────────────────────────────────────────────────────────────
  async resetForzado(configId: string): Promise<void> {
    await this.setEstado(configId, 'closed', {
      circuitFallas:       0,
      circuitAbiertoHasta: null,
    });
    this.logger.log(`Circuit reset manual | config=${configId}`);
  }

  // ────────────────────────────────────────────────────────────
  // Helpers privados
  // ────────────────────────────────────────────────────────────

  private async readState(configId: string): Promise<CacheEntry> {
    const cached = this.cache.get(configId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached;
    }

    const row = await this.repo.findOne({ where: { id: configId } });
    if (!row) {
      // Config eliminada en BD — permitir intento (fail-open por seguridad)
      return { estado: 'closed', fallas: 0, abiertoHasta: null, expiresAt: 0 };
    }

    const entry: CacheEntry = {
      estado:       row.circuitEstado,
      fallas:       row.circuitFallas,
      abiertoHasta: row.circuitAbiertoHasta,
      expiresAt:    Date.now() + this.CACHE_TTL_MS,
    };
    this.cache.set(configId, entry);
    return entry;
  }

  private async setEstado(
    configId: string,
    estado:   CircuitEstado,
    extra:    Partial<OltProveedorConfig> = {},
  ): Promise<void> {
    await this.repo.update(configId, { circuitEstado: estado, ...extra });
    this.cache.delete(configId);   // siguiente lectura viene de BD
  }
}
