import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ProvisionFtthService } from '../services/provision-ftth.service';

// Corre cada 20 min (desfasado de FtthWanWatcherCron, que corre cada 10) para
// no concentrar carga sobre la OLT/GenieACS en el mismo instante.
@Injectable()
export class Tr069CpeDriftWatcherCron {
  private readonly logger = new Logger(Tr069CpeDriftWatcherCron.name);
  private running = false;

  constructor(private readonly ftth: ProvisionFtthService) {}

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
}
