import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { ZtpProvisioningService } from '../ztp/ztp.service';

// ─────────────────────────────────────────────────────────────
// ZtpReconcileCron
//
// Auditoría nocturna del pipeline TR-069: el ERP es la fuente de verdad.
// Busca contratos con provisioning_enabled y drift (config deseada > aplicada)
// y re-aplica el ExecutionPlan sobre la ONU (con ConnectionRequest).
//
// Horario 3:30 America/Lima — disjunto del health-poller (x0/x30) y del
// housekeeping FTTH (2:30) para no colisionar sesiones sobre el mismo hardware.
// Solo se registra si RUN_CRONS=true (ScheduleModule condicional en app.module).
// ─────────────────────────────────────────────────────────────
@Injectable()
export class ZtpReconcileCron {
  private readonly logger = new Logger(ZtpReconcileCron.name);
  private running = false;

  constructor(private readonly ztp: ZtpProvisioningService) {}

  @Cron('30 3 * * *', { timeZone: 'America/Lima' })
  async reconciliarDiario(): Promise<void> {
    // Guard reentrante: si el barrido previo aún corre (muchas ONUs lentas), no solapar.
    if (this.running) {
      this.logger.warn('Reconcile previo aún en curso — se omite este disparo.');
      return;
    }
    this.running = true;
    try {
      const r = await this.ztp.reconcile();
      if (r.conDrift > 0) {
        this.logger.log(`Reconcile nocturno: drift=${r.conDrift} ok=${r.ok} fallidas=${r.fallidas}`);
      }
    } catch (e) {
      // Nunca relanzar desde un cron: tumbaría el proceso PM2.
      this.logger.error(`Reconcile nocturno falló: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.running = false;
    }
  }
}
