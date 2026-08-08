import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { ConsumoColectorService } from './consumo-colector.service';

// Recolección de consumo cada 15 minutos.
//
// El intervalo no es arbitrario: los contadores son acumulados, así que el consumo no se
// pierde entre corridas (una corrida saltada la recupera la siguiente, con un delta mayor).
// 15 minutos da resolución suficiente para un gráfico por día sin hablar con los routers
// más de lo necesario.
@Injectable()
export class ConsumoColectorCron {
  private readonly logger = new Logger(ConsumoColectorCron.name);
  private corriendo = false;

  constructor(private readonly colector: ConsumoColectorService) {}

  @Cron('3-59/15 * * * *', { name: 'portal-consumo-colector' })
  async recolectar(): Promise<void> {
    // Un solo proceso recolecta: dos instancias PM2 leyendo los mismos contadores
    // duplicarían el consumo del abonado, porque cada una acumularía su propio delta
    // sobre la misma fila horaria.
    if (process.env.RUN_CRONS !== 'true') return;
    if (!this.colector.habilitado()) return;

    // Reentrada: una corrida lenta (routers por VPN con latencia) no debe solaparse con
    // la siguiente, o ambas leerían el mismo contador y una escribiría un delta falso.
    if (this.corriendo) {
      this.logger.warn('Consumo: la corrida anterior sigue en curso, se omite esta.');
      return;
    }

    this.corriendo = true;
    try {
      await this.colector.recolectar();
    } catch (e) {
      this.logger.error(
        `ConsumoColectorCron falló: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      this.corriendo = false;
    }
  }
}
