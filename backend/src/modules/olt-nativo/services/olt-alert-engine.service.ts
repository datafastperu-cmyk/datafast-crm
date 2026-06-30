import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository }   from '@nestjs/typeorm';
import { Repository }         from 'typeorm';

import { OltAlerta, AlertaSeveridad, AlertaTipo } from '../entities/olt-alerta.entity';

// ─────────────────────────────────────────────────────────────
// OltAlertEngineService
//
// Evalúa reglas de alerta después de cada ciclo de polling.
// Deduplicación: UNIQUE parcial en BD (olt_id, tipo, entidad_ref)
// WHERE estado = 'activa' — solo una alerta activa por condición.
//
// Reglas implementadas:
//   board_fault        : boardState === 'fault'
//   pom_temp_warn      : tempCelsius > 70
//   pom_temp_critical  : tempCelsius > 80
//   pom_tx_degradado   : txDbm < -3 (media) | < -6 (alta)
//   pom_rx_warn        : rxDbm  < -27 (media) | < -30 (alta)
//
// Auto-resuelve cuando la condición desaparece.
// ─────────────────────────────────────────────────────────────
@Injectable()
export class OltAlertEngineService {
  private readonly logger = new Logger(OltAlertEngineService.name);

  constructor(
    @InjectRepository(OltAlerta)
    private readonly alertRepo: Repository<OltAlerta>,
  ) {}

  // ── API pública ───────────────────────────────────────────────

  async evalBoardAlerts(
    oltId:     string,
    empresaId: string,
    boards:    Array<{ slot: number; state: string; board_type: string; onu_count: number }>,
  ): Promise<void> {
    const tipo: AlertaTipo = 'board_fault';
    const existing = await this._loadActive(oltId, tipo);

    for (const board of boards) {
      const ref = `slot:${board.slot}`;
      const isFault = board.state === 'fault';
      const alert = existing.get(ref);

      if (isFault && !alert) {
        await this._create({
          oltId, empresaId, tipo,
          severidad:   'alta',
          entidadTipo: 'board',
          entidadRef:  ref,
          mensaje:     `Slot ${board.slot} (${board.board_type || '?'}) reporta estado fault`,
        });
      } else if (!isFault && alert) {
        await this._resolve(alert);
        existing.delete(ref);
      }
    }

    // Resolver alertas de slots que ya no aparecen en el snapshot (probablemente absent)
    const pollSlots = new Set(boards.map((b) => `slot:${b.slot}`));
    for (const [ref, alert] of existing) {
      if (!pollSlots.has(ref)) await this._resolve(alert);
    }
  }

  async evalPomAlerts(
    oltId:     string,
    empresaId: string,
    poms:      Array<{ slot: number; port: number; temp_celsius: number | null; tx_dbm: number | null; rx_dbm: number | null }>,
  ): Promise<void> {
    await Promise.all([
      this._evalTempAlerts(oltId, empresaId, poms),
      this._evalTxAlerts(oltId,   empresaId, poms),
      this._evalRxAlerts(oltId,   empresaId, poms),
    ]);
  }

  // ── Reglas de temperatura ─────────────────────────────────────

  private async _evalTempAlerts(
    oltId: string, empresaId: string,
    poms:  Array<{ slot: number; port: number; temp_celsius: number | null }>,
  ): Promise<void> {
    const [existWarn, existCrit] = await Promise.all([
      this._loadActive(oltId, 'pom_temp_warn'),
      this._loadActive(oltId, 'pom_temp_critical'),
    ]);

    for (const p of poms) {
      const ref  = `${p.slot}/${p.port}`;
      const t    = p.temp_celsius;
      const isCrit = t != null && t > 80;
      const isWarn = t != null && t > 70 && !isCrit;

      if (isCrit && !existCrit.has(ref)) {
        await this._create({ oltId, empresaId, tipo: 'pom_temp_critical', severidad: 'critica', entidadTipo: 'port', entidadRef: ref,
          mensaje: `Puerto ${ref}: temperatura ${t!.toFixed(1)}°C supera umbral crítico (>80°C)` });
      } else if (!isCrit && existCrit.has(ref)) {
        await this._resolve(existCrit.get(ref)!);
      }

      if (isWarn && !existWarn.has(ref)) {
        await this._create({ oltId, empresaId, tipo: 'pom_temp_warn', severidad: 'media', entidadTipo: 'port', entidadRef: ref,
          mensaje: `Puerto ${ref}: temperatura ${t!.toFixed(1)}°C supera umbral de advertencia (>70°C)` });
      } else if (!isWarn && existWarn.has(ref)) {
        await this._resolve(existWarn.get(ref)!);
      }
    }
  }

  // ── Reglas Tx (potencia de transmisión) ───────────────────────

  private async _evalTxAlerts(
    oltId: string, empresaId: string,
    poms:  Array<{ slot: number; port: number; tx_dbm: number | null }>,
  ): Promise<void> {
    const existing = await this._loadActive(oltId, 'pom_tx_degradado');

    for (const p of poms) {
      const ref   = `${p.slot}/${p.port}`;
      const tx    = p.tx_dbm;
      const isBad = tx != null && tx < -3;
      const sev: AlertaSeveridad = tx != null && tx < -6 ? 'alta' : 'media';

      if (isBad) {
        const alert = existing.get(ref);
        if (!alert) {
          await this._create({ oltId, empresaId, tipo: 'pom_tx_degradado', severidad: sev, entidadTipo: 'port', entidadRef: ref,
            mensaje: `Puerto ${ref}: Tx ${tx!.toFixed(2)} dBm ${sev === 'alta' ? '(crítico <-6 dBm)' : '(advertencia <-3 dBm)'}` });
        } else if (alert.severidad !== sev) {
          await this.alertRepo.update(alert.id, {
            severidad: sev,
            mensaje:   `Puerto ${ref}: Tx ${tx!.toFixed(2)} dBm ${sev === 'alta' ? '(crítico <-6 dBm)' : '(advertencia <-3 dBm)'}`,
            updatedAt: new Date(),
          });
        }
      } else if (existing.has(ref)) {
        await this._resolve(existing.get(ref)!);
      }
    }
  }

  // ── Reglas Rx (potencia de recepción) ─────────────────────────

  private async _evalRxAlerts(
    oltId: string, empresaId: string,
    poms:  Array<{ slot: number; port: number; rx_dbm: number | null }>,
  ): Promise<void> {
    const existing = await this._loadActive(oltId, 'pom_rx_warn');

    for (const p of poms) {
      const ref   = `${p.slot}/${p.port}`;
      const rx    = p.rx_dbm;
      const isBad = rx != null && rx < -27;
      const sev: AlertaSeveridad = rx != null && rx < -30 ? 'alta' : 'media';

      if (isBad) {
        const alert = existing.get(ref);
        if (!alert) {
          await this._create({ oltId, empresaId, tipo: 'pom_rx_warn', severidad: sev, entidadTipo: 'port', entidadRef: ref,
            mensaje: `Puerto ${ref}: Rx ${rx!.toFixed(2)} dBm ${sev === 'alta' ? '(crítico <-30 dBm)' : '(advertencia <-27 dBm)'}` });
        } else if (alert.severidad !== sev) {
          await this.alertRepo.update(alert.id, {
            severidad: sev,
            mensaje:   `Puerto ${ref}: Rx ${rx!.toFixed(2)} dBm ${sev === 'alta' ? '(crítico <-30 dBm)' : '(advertencia <-27 dBm)'}`,
            updatedAt: new Date(),
          });
        }
      } else if (existing.has(ref)) {
        await this._resolve(existing.get(ref)!);
      }
    }
  }

  // ── Helpers privados ──────────────────────────────────────────

  private async _loadActive(oltId: string, tipo: AlertaTipo): Promise<Map<string, OltAlerta>> {
    const alerts = await this.alertRepo.find({
      where: { oltId, tipo, estado: 'activa' },
      select: ['id', 'entidadRef', 'severidad'],
    });
    return new Map(alerts.map((a) => [a.entidadRef ?? '', a]));
  }

  private async _create(params: {
    oltId:       string;
    empresaId:   string;
    tipo:        AlertaTipo;
    severidad:   AlertaSeveridad;
    entidadTipo: string;
    entidadRef:  string;
    mensaje:     string;
  }): Promise<void> {
    const alerta = this.alertRepo.create({ ...params, estado: 'activa' });
    try {
      await this.alertRepo.save(alerta);
      this.logger.warn(`ALERTA ${params.tipo} [${params.severidad}] ${params.oltId} ${params.entidadRef}: ${params.mensaje}`);
    } catch (err: any) {
      if (err?.code === '23505') return; // unique — otro worker la creó antes
      this.logger.error(`Error creando alerta ${params.tipo}: ${err.message}`);
    }
  }

  private async _resolve(alerta: OltAlerta): Promise<void> {
    await this.alertRepo.update(alerta.id, {
      estado:     'resuelta',
      resolvedAt: new Date(),
      updatedAt:  new Date(),
    });
    this.logger.log(`Alerta resuelta: ${alerta.id}`);
  }
}
