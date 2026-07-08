import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { Tr069GenieacsClient, GenieTask } from './tr069-genieacs.client';
import { ModuleHealthService } from '../../common/services/module-health.service';

// ─────────────────────────────────────────────────────────────
// Tr069Service — punto de entrada del ERP al ecosistema TR-069 (vía GenieACS).
//
// Módulo DEGRADABLE (regla obligatoria del proyecto): si GenieACS no está
// configurado o no responde, arranca 'degraded' y el backend sigue vivo. Los
// métodos que tocan el ACS validan assertNotDegraded() → 503 controlado.
//
// Fase 0a: cimiento (probe de salud + wrappers base). El poblado del read-model
// y los endpoints/UI llegan en Fase 1 (lectura) y Fase 2 (escritura).
// ─────────────────────────────────────────────────────────────
@Injectable()
export class Tr069Service implements OnModuleInit {
  private readonly logger = new Logger(Tr069Service.name);
  private degraded       = true;
  private degradedReason: string | null = 'TR-069 no inicializado';

  constructor(
    private readonly acs:          Tr069GenieacsClient,
    private readonly moduleHealth: ModuleHealthService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.acs.isConfigured()) {
      this.setDegraded('GenieACS no configurado (GENIEACS_NBI_URL vacío)');
      return;
    }
    try {
      const r = await this.acs.probe();
      if (r.ok) {
        this.degraded = false;
        this.degradedReason = null;
        this.moduleHealth.registrar('tr069', 'ok');
      } else {
        this.setDegraded(r.error ?? 'GenieACS no responde');
      }
    } catch (err) {
      // NUNCA relanzar en onModuleInit — crashearía el backend.
      this.setDegraded((err as Error).message);
    }
  }

  private setDegraded(reason: string): void {
    this.degraded = true;
    this.degradedReason = reason;
    this.moduleHealth.registrar('tr069', 'degraded', reason);
  }

  isDegraded(): boolean { return this.degraded; }
  estado(): { estado: 'ok' | 'degraded'; razon: string | null } {
    return { estado: this.degraded ? 'degraded' : 'ok', razon: this.degradedReason };
  }

  private assertNotDegraded(): void {
    if (this.degraded) {
      throw new ServiceUnavailableException(
        `Módulo TR-069 degradado: ${this.degradedReason ?? 'ACS no disponible'}`,
      );
    }
  }

  // ── Operaciones base (usadas por Fase 1/2) ────────────────────
  async listarDevices(query: Record<string, unknown> = {}, projection?: string): Promise<any[]> {
    this.assertNotDegraded();
    return this.acs.listDevices(query, projection);
  }

  async reiniciarCpe(genieId: string): Promise<{ encolado: boolean; status: number }> {
    this.assertNotDegraded();
    const r = await this.acs.queueTask(genieId, { name: 'reboot' });
    return { encolado: r.status === 200 || r.status === 202, status: r.status };
  }

  async setParametros(genieId: string, parameterValues: Array<[string, unknown, string?]>): Promise<{ encolado: boolean; status: number }> {
    this.assertNotDegraded();
    const task: GenieTask = { name: 'setParameterValues', parameterValues };
    const r = await this.acs.queueTask(genieId, task);
    return { encolado: r.status === 200 || r.status === 202, status: r.status };
  }
}
