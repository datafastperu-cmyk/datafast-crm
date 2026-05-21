import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { MantenimientoService } from './mantenimiento.service';
import { QUEUES } from '../workers/workers.constants';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUES.COBRANZA },
      { name: QUEUES.FACTURACION },
      { name: QUEUES.NOTIFICACIONES },
      { name: QUEUES.MIKROTIK },
      { name: QUEUES.GOOGLE_SYNC },
    ),
  ],
  providers: [MantenimientoService],
})
export class MantenimientoModule {}
