import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ProvisionFtthService } from '../services/provision-ftth.service';
import { EventosSistemaService } from '../../sistema/eventos-sistema.service';
import { GenieAcsDriver } from '../ztp/genieacs.driver';
import { CwmpAuthService } from '../ztp/cwmp-auth.service';

// Corre cada 20 min (desfasado de FtthWanWatcherCron, que corre cada 10) para
// no concentrar carga sobre la OLT/GenieACS en el mismo instante.
@Injectable()
export class Tr069CpeDriftWatcherCron {
  private readonly logger = new Logger(Tr069CpeDriftWatcherCron.name);
  private running = false;
  private barriendo = false;
  private desendureciendo = false;

  constructor(
    private readonly ftth: ProvisionFtthService,
    private readonly eventos: EventosSistemaService,
    private readonly genie: GenieAcsDriver,
    private readonly cwmpAuth: CwmpAuthService,
  ) {}

  // Desendurecimiento residual (2026-07-28). Con la política de endurecimiento CWMP
  // desactivada, los devices tagueados por la etapa anterior siguen exigiendo un HMAC
  // que ya nadie reescribe: un factory reset de cualquiera de ellos reproduce el
  // deadlock de gestión del 24/07. Desactivar la política solo evita crear deadlocks
  // NUEVOS — el riesgo latente hay que ir a buscarlo.
  //
  // Diario y desfasado del resto (03:40 Lima). Se detiene solo cuando ya no queda
  // ningún device con el tag, así que su costo en régimen es una query.
  @Cron('40 3 * * *', { timeZone: 'America/Lima' })
  async desendurecerAuthResidual(): Promise<void> {
    if (this.desendureciendo) return;
    if (this.cwmpAuth.isEnforcementEnabled()) return; // política activa: no tocar nada
    this.desendureciendo = true;
    try {
      const r = await this.genie.desendurecerAuthResidual();
      if (r.revisados === 0) return; // nada que hacer, sin ruido
      await this.eventos.registrar({
        nivel:    r.fallidos > 0 ? 'error' : 'warn',
        origen:   'olt',
        codigo:   'TR069_AUTH_DESENDURECIDA',
        mensaje:
          `Endurecimiento CWMP residual retirado de ${r.desendurecidos}/${r.revisados} device(s)` +
          `${r.fallidos > 0 ? ` — ${r.fallidos} fallaron y se reintentarán` : ''}. ` +
          `Elimina el riesgo de deadlock de gestión tras un factory reset.`,
        contexto: r,
      });
    } catch (e) {
      this.logger.error(`desendurecerAuthResidual falló: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.desendureciendo = false;
    }
  }

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
