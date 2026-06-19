import { Module }         from '@nestjs/common';
import { BullModule }     from '@nestjs/bull';

import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { QUEUES }               from '../workers/workers.constants';
import { CampanasController }   from './campanas.controller';
import { CampanasService }      from './campanas.service';
import { MensajeriaWorker }       from './mensajeria.worker';
import { GatewayMonitorService }  from './gateway-monitor.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUES.NOTIFICACIONES }),
    NotificacionesModule,
  ],
  controllers: [CampanasController],
  providers:   [CampanasService, MensajeriaWorker, GatewayMonitorService],
})
export class MensajeriaModule {}
