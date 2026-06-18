import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { QUEUES } from '../../modules/workers/workers.constants';
import { VELOCIDAD_QUEUE } from '../../modules/mikrotik/velocidad.worker';

@Injectable()
export class QueuePauseService implements OnApplicationBootstrap {
  private readonly logger = new Logger(QueuePauseService.name);

  constructor(
    @InjectQueue(QUEUES.COBRANZA)       private readonly qCobranza: Queue,
    @InjectQueue(QUEUES.FACTURACION)    private readonly qFacturacion: Queue,
    @InjectQueue(QUEUES.NOTIFICACIONES) private readonly qNotificaciones: Queue,
    @InjectQueue(QUEUES.GOOGLE_SYNC)    private readonly qGoogleSync: Queue,
    @InjectQueue(VELOCIDAD_QUEUE)       private readonly qVelocidad: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.RUN_CRONS === 'true') return;

    // Pausa local (este proceso no consume jobs; el worker-auxiliary lo hace)
    await Promise.all([
      this.qCobranza.pause(true),
      this.qFacturacion.pause(true),
      this.qNotificaciones.pause(true),
      this.qGoogleSync.pause(true),
      this.qVelocidad.pause(true),
    ]);
    this.logger.log('API Core: queues Bull pausados localmente — worker-auxiliary es el consumidor');
  }
}
