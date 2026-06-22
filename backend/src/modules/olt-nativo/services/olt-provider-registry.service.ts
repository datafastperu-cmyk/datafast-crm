import { Injectable } from '@nestjs/common';

import { TipoProveedor }      from '../entities/olt-proveedor-config.entity';
import { IOltProvider }       from '../interfaces/olt-provider.interface';
import { NativoSshProvider }  from '../providers/nativo-ssh.provider';
import { SmartoltProvider }   from '../providers/smartolt.provider';
import { AdminOltProvider }   from '../providers/adminolt.provider';

// ─────────────────────────────────────────────────────────────
// OltProviderRegistry
//
// Singleton que mantiene el mapa TipoProveedor → IOltProvider.
// El Router y el HealthMonitor lo usan para resolver el adaptador
// correcto sin acoplar al tipo concreto.
//
// Garantía de exhaustividad: si se agrega un TipoProveedor nuevo
// pero no se registra aquí, `get()` lanzará en tiempo de ejecución
// con un mensaje explícito — nunca falla silenciosamente.
// ─────────────────────────────────────────────────────────────
@Injectable()
export class OltProviderRegistry {
  private readonly registry: Map<TipoProveedor, IOltProvider>;

  constructor(
    nativoSsh: NativoSshProvider,
    smartolt:  SmartoltProvider,
    adminOlt:  AdminOltProvider,
  ) {
    this.registry = new Map<TipoProveedor, IOltProvider>([
      ['nativo_ssh', nativoSsh],
      ['smartolt',   smartolt],
      ['adminolt',   adminOlt],
    ]);
  }

  // Resuelve el adaptador para un tipo de proveedor.
  // Lanza si el tipo no está registrado (bug en tiempo de desarrollo).
  get(tipo: TipoProveedor): IOltProvider {
    const provider = this.registry.get(tipo);
    if (!provider) {
      throw new Error(
        `OltProviderRegistry: proveedor "${tipo}" no registrado. ` +
        `Tipos disponibles: ${[...this.registry.keys()].join(', ')}`,
      );
    }
    return provider;
  }

  // Retorna todos los adaptadores registrados.
  // Usado por OltHealthMonitorService para iterar en paralelo.
  getAll(): IOltProvider[] {
    return [...this.registry.values()];
  }

  has(tipo: TipoProveedor): boolean {
    return this.registry.has(tipo);
  }

  // Lista los tipos registrados — útil para logs y diagnóstico.
  tiposDisponibles(): TipoProveedor[] {
    return [...this.registry.keys()];
  }
}
