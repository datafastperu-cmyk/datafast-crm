import { Injectable, Logger } from '@nestjs/common';

export type ModuleEstado = 'ok' | 'degraded';

export interface ModuleHealthRecord {
  modulo:  string;
  estado:  ModuleEstado;
  razon?:  string;
  desde:   Date;
}

@Injectable()
export class ModuleHealthService {
  private readonly logger   = new Logger(ModuleHealthService.name);
  private readonly registry = new Map<string, ModuleHealthRecord>();

  registrar(modulo: string, estado: ModuleEstado, razon?: string): void {
    const previo = this.registry.get(modulo);

    // Solo loggar cuando cambia el estado
    if (!previo || previo.estado !== estado) {
      if (estado === 'degraded') {
        this.logger.warn(`[${modulo}] → DEGRADADO: ${razon ?? 'sin detalle'}`);
      } else {
        this.logger.log(`[${modulo}] → OK`);
      }
    }

    this.registry.set(modulo, { modulo, estado, razon, desde: new Date() });
  }

  getEstado(modulo: string): ModuleHealthRecord | undefined {
    return this.registry.get(modulo);
  }

  getEstados(): ModuleHealthRecord[] {
    return Array.from(this.registry.values()).sort((a, b) =>
      a.modulo.localeCompare(b.modulo),
    );
  }

  hayDegradados(): boolean {
    return Array.from(this.registry.values()).some(r => r.estado === 'degraded');
  }

  // Resumen compacto para el endpoint /status existente
  resumen(): Record<string, string | { estado: string; razon?: string }> {
    const result: Record<string, string | { estado: string; razon?: string }> = {};
    for (const rec of this.registry.values()) {
      result[rec.modulo] = rec.estado === 'ok'
        ? 'ok'
        : { estado: 'degraded', razon: rec.razon };
    }
    return result;
  }
}
