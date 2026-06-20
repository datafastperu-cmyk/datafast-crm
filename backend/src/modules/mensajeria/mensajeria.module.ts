import { Module }         from '@nestjs/common';
import { BullModule }     from '@nestjs/bull';

import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { QUEUES }               from '../workers/workers.constants';
import { CampanasController }   from './campanas.controller';
import { CampanasService }      from './campanas.service';
import { MensajeriaWorker }     from './mensajeria.worker';
import { CampanasWorker }       from './campanas.worker';
import { GatewayMonitorService }  from './gateway-monitor.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUES.NOTIFICACIONES }),
    BullModule.registerQueue({ name: QUEUES.CAMPANAS }),
    NotificacionesModule,
  ],
  controllers: [CampanasController],
  providers:   [CampanasService, MensajeriaWorker, CampanasWorker, GatewayMonitorService],
})
export class MensajeriaModule {}
