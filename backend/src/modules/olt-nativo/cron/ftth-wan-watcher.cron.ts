import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { ProvisionFtthService } from '../services/provision-ftth.service';

// ─────────────────────────────────────────────────────────────
// FtthWanWatcherCron
//
// Watcher de re-inyección post factory-reset para el flujo FTTH NATIVO (distinto
// del watcher ZTP/TR-069 de ZtpReconcileCron, que no cubre estas ONUs — ver
// ProvisionFtthService::verificarYRepararWanDrift para la causa raíz completa).
//
// Verifica CADA ONU activa con una sesión SSH individual (sin evento que marque
// drift explícitamente para un reset físico — la única señal es el estado real
// de la OLT). Con pocas decenas de ONUs esto es barato; si el volumen de ONUs
// activas crece mucho, este watcher necesitará batchear la verificación (p.ej.
// un solo `display ont wan-info` por puerto en vez de por ONU) para no saturar
// la cola de sesiones SSH de la OLT. Horario disjunto de FtthRecoveryCron
// (min 4-59/5) y del health-poller (x0/x30).
// ─────────────────────────────────────────────────────────────
@Injectable()
export class FtthWanWatcherCron {
  private readonly logger = new Logger(FtthWanWatcherCron.name);
  private running = false;

  constructor(private readonly ftth: ProvisionFtthService) {}

  @Cron('*/10 * * * *')
  async verificarWan(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.ftth.verificarYRepararWanDrift();
    } catch (e) {
      this.logger.error(`FtthWanWatcherCron falló: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.running = false;
    }
  }
}
