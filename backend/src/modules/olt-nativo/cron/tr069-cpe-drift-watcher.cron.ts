import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ProvisionFtthService } from '../services/provision-ftth.service';
import { EventosSistemaService } from '../../sistema/eventos-sistema.service';

// Corre cada 20 min (desfasado de FtthWanWatcherCron, que corre cada 10) para
// no concentrar carga sobre la OLT/GenieACS en el mismo instante.
@Injectable()
export class Tr069CpeDriftWatcherCron {
  private readonly logger = new Logger(Tr069CpeDriftWatcherCron.name);
  private running = false;
  private barriendo = false;

  constructor(
    private readonly ftth: ProvisionFtthService,
    private readonly eventos: EventosSistemaService,
  ) {}

  @Cron('5-59/20 * * * *')
  async verificarDrift(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.ftth.reconciliarTr069Drift();
    } catch (e) {
      this.logger.error(`Tr069CpeDriftWatcherCron falló: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.running = false;
    }
  }

  // Fase 3 — barrido TTL diario (04:20 Lima). Desactiva carriles TR-069 activos
  // sin uso por N días (default 3). Deja constancia en eventos_sistema por cada
  // carril tocado: es una acción del sistema sobre infraestructura, debe auditarse.
  @Cron('20 4 * * *', { timeZone: 'America/Lima' })
  async barrerTtl(): Promise<void> {
    if (this.barriendo) return;
    this.barriendo = true;
    try {
      const resultados = await this.ftth.barrerCarrilesTr069Inactivos();
      for (const r of resultados) {
        await this.eventos.registrar({
          nivel:   r.ok ? 'warn' : 'error',
          origen:  'olt',
          codigo:  'TR069_CARRIL_TTL',
          mensaje: r.ok
            ? `Carril TR-069 desactivado por inactividad | contrato=${r.contratoId} → ${r.estado}`
            : `Barrido TTL no pudo desactivar el carril | contrato=${r.contratoId}: ${r.mensaje}`,
          contexto: { contratoId: r.contratoId, estado: r.estado },
        });
      }
    } catch (e) {
      this.logger.error(`barrerTtl falló: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.barriendo = false;
    }
  }
}
