import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  CpeProvisioningAttempt, ResultadoIntento,
} from '../../entities/cpe-provisioning-attempt.entity';
import { NombreCanal } from '../../capability/cpe-provisioning-catalog';

// ─────────────────────────────────────────────────────────────
// Circuit breaker por (ONT, canal). Umbrales DELIBERADAMENTE distintos
// por canal — no es el mismo riesgo fallar un OMCI que fallar un login
// HTTP contra el propio CPE:
//
//   omci_tr069: el fallo es del lado de la OLT (SSH), sin riesgo de
//               bloquear el equipo del cliente. Umbral relajado.
//
//   http_web:   el CPE se autobloquea a los 3 intentos de login fallidos
//               (confirmado en vivo, incidente CNT-2026-000004). Umbral
//               de 1 fallo + cooldown largo — MUCHO más conservador que
//               cualquier login real del equipo, para nunca acercarse
//               al límite de lockout del propio dispositivo.
// ─────────────────────────────────────────────────────────────
interface Umbral { maxIntentos: number; cooldownMs: number; }

const UMBRALES: Record<NombreCanal, Umbral> = {
  dhcp_bootstrap:         { maxIntentos: 3, cooldownMs: 2 * 60_000 },   // 2 min
  omci_management_server: { maxIntentos: 3, cooldownMs: 2 * 60_000 },   // 2 min
  cpe_local:              { maxIntentos: 1, cooldownMs: 30 * 60_000 },  // 30 min (autolockout del panel)
};

@Injectable()
export class CpeProvisioningAttemptService {
  private readonly logger = new Logger(CpeProvisioningAttemptService.name);

  constructor(
    @InjectRepository(CpeProvisioningAttempt)
    private readonly repo: Repository<CpeProvisioningAttempt>,
  ) {}

  private async obtenerOCrear(
    empresaId: string, ftthRegistroId: string, canal: NombreCanal,
  ): Promise<CpeProvisioningAttempt> {
    let row = await this.repo.findOne({ where: { ftthRegistroId, canal } });
    if (!row) {
      row = this.repo.create({
        empresaId, ftthRegistroId, canal, estadoCircuito: 'closed', intentosConsecutivos: 0,
      });
      row = await this.repo.save(row);
    }
    return row;
  }

  /** ¿Se puede intentar este canal ahora para este registro? */
  async canAttempt(empresaId: string, ftthRegistroId: string, canal: NombreCanal): Promise<{ permitido: boolean; motivo?: string }> {
    const row = await this.obtenerOCrear(empresaId, ftthRegistroId, canal);
    if (row.estadoCircuito === 'closed') return { permitido: true };
    if (row.bloqueadoHasta && row.bloqueadoHasta.getTime() <= Date.now()) {
      // Cooldown cumplido → permitir UN intento de prueba (half-open implícito:
      // si falla, recordFailure vuelve a abrir el circuito de inmediato).
      return { permitido: true };
    }
    const restanteMin = row.bloqueadoHasta
      ? Math.ceil((row.bloqueadoHasta.getTime() - Date.now()) / 60_000)
      : null;
    return {
      permitido: false,
      motivo: `Canal "${canal}" en cooldown por fallos previos${restanteMin != null ? ` (~${restanteMin} min restantes)` : ''}.`,
    };
  }

  async recordFailure(
    empresaId: string, ftthRegistroId: string, canal: NombreCanal,
    resultado: ResultadoIntento, error?: string,
  ): Promise<void> {
    const row = await this.obtenerOCrear(empresaId, ftthRegistroId, canal);
    const umbral = UMBRALES[canal];
    const intentos = row.intentosConsecutivos + 1;

    const abrir = row.estadoCircuito === 'open' || intentos >= umbral.maxIntentos;
    const bloqueadoHasta = abrir ? new Date(Date.now() + umbral.cooldownMs) : row.bloqueadoHasta;

    await this.repo.update(row.id, {
      intentosConsecutivos: abrir ? 0 : intentos,
      estadoCircuito:       abrir ? 'open' : 'closed',
      bloqueadoHasta:       abrir ? bloqueadoHasta : null,
      ultimoIntentoEn:      new Date(),
      ultimoResultado:      resultado,
      ultimoError:          error ?? null,
    });

    if (abrir) {
      this.logger.warn(
        `Circuit CPE → OPEN | registro=${ftthRegistroId} canal=${canal} ` +
        `hasta=${bloqueadoHasta?.toISOString()} razon="${error ?? resultado}"`,
      );
    }
  }

  async recordSuccess(empresaId: string, ftthRegistroId: string, canal: NombreCanal): Promise<void> {
    const row = await this.obtenerOCrear(empresaId, ftthRegistroId, canal);
    await this.repo.update(row.id, {
      intentosConsecutivos: 0,
      estadoCircuito:       'closed',
      bloqueadoHasta:       null,
      ultimoIntentoEn:      new Date(),
      ultimoResultado:      'exitoso',
      ultimoError:          null,
    });
  }
}
