import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { PlantaExternaPuertosService } from './planta-externa-puertos.service';

/**
 * Barrido de reservas de puerto vencidas.
 *
 * Es el MECANISMO REAL de anulación del wizard de alta, no una red de seguridad
 * secundaria. La directriz de wizards lo dice explícitamente (punto 10): el servidor es
 * la autoridad, porque `beforeunload` no puede ejecutar trabajo asíncrono fiable y el
 * cierre puede ser un crash del navegador, un corte de luz o una sesión caída —
 * precisamente los casos que motivan la regla. Una frontera que no existe en el caso que
 * la justifica no es una frontera.
 *
 * Cada 5 minutos y no cada minuto: el TTL de una reserva es de 20 min, así que barrer
 * más seguido no libera nada antes y sólo agrega escrituras. Cada hora sería demasiado
 * tarde — un puerto retenido media hora de más bloquea una instalación real.
 */
@Injectable()
export class PlantaExternaBarridoCron implements OnModuleInit {
  private readonly logger = new Logger(PlantaExternaBarridoCron.name);

  constructor(
    private readonly puertos: PlantaExternaPuertosService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    if (process.env.RUN_CRONS !== 'true') return;
    const job = new CronJob('*/5 * * * *', () => this.ejecutar(), null, true);
    this.schedulerRegistry.addCronJob('planta-externa-barrido-reservas', job);
  }

  async ejecutar(): Promise<void> {
    // Sólo la instancia principal del clúster PM2. Sin este guard, N instancias barren
    // a la vez: el UPDATE es idempotente así que no corrompe nada, pero multiplica la
    // escritura por N sin liberar un solo puerto más.
    if (process.env.NODE_APP_INSTANCE !== undefined && process.env.NODE_APP_INSTANCE !== '0') return;

    try {
      await this.puertos.barrerReservasExpiradas();
    } catch (err) {
      // Nunca relanzar: un cron que lanza tumba el proceso. Se registra y el próximo
      // ciclo lo reintenta — las reservas vencidas siguen ahí, no se pierden.
      this.logger.error(
        `Barrido de reservas falló: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
