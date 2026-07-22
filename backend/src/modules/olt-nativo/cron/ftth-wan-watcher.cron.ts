import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { ProvisionFtthService } from '../services/provision-ftth.service';
import { CompensadorWizardService } from '../services/compensador-wizard.service';

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

  constructor(
    private readonly ftth: ProvisionFtthService,
    private readonly compensador: CompensadorWizardService,
  ) {}

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

  // Watcher del invariante de atomicidad: reintenta la limpieza de la OLT para registros
  // en `fallido_rollback` (rollback no confirmado) hasta dejar la OLT limpia y liberar el
  // registro. Horario disjunto del verificarWan (min 5-59/10) para no solapar sesiones SSH.
  private runningRollback = false;

  @Cron('5-59/10 * * * *')
  async reintentarRollbacks(): Promise<void> {
    if (this.runningRollback) return;
    this.runningRollback = true;
    try {
      await this.ftth.reintentarRollbacksFallidos();
    } catch (e) {
      this.logger.error(`FtthWanWatcherCron.reintentarRollbacks falló: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.runningRollback = false;
    }
  }

  // Watcher de la cara CREATE del invariante: adopta ONUs aprovisionadas en la OLT y
  // vinculadas a un contrato vigente pero sin `ftth_onu_registro` (huérfanos de creación),
  // reconstruyendo el registro. Cada 30 min, horario disjunto de los otros dos watchers.
  private runningAdopt = false;

  @Cron('7-59/30 * * * *')
  async adoptarHuerfanas(): Promise<void> {
    if (this.runningAdopt) return;
    this.runningAdopt = true;
    try {
      await this.ftth.adoptarOnusHuerfanas();
    } catch (e) {
      this.logger.error(`FtthWanWatcherCron.adoptarHuerfanas falló: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.runningAdopt = false;
    }
  }

  // Anulación de procedimientos cerrados sin confirmar: compensa sus pasos en LIFO
  // (Fase 2). Cada 3 min para que el operador vea el sistema limpio pronto tras cerrar,
  // pero con lote acotado y una sola pasada por ciclo — nada de reintentos agresivos
  // contra la OLT. Minutos 2,5,8… disjuntos del resto de watchers FTTH.
  private runningAnular = false;

  @Cron('2-59/3 * * * *')
  async procesarAnulaciones(): Promise<void> {
    if (this.runningAnular) return;
    this.runningAnular = true;
    try {
      await this.compensador.procesarPendientes();
    } catch (e) {
      this.logger.error(`FtthWanWatcherCron.procesarAnulaciones falló: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.runningAnular = false;
    }
  }
}
