import { Module }        from '@nestjs/common';

import { MikrotikModule }      from '../mikrotik/mikrotik.module';
import { OltNativoModule }     from '../olt-nativo/olt-nativo.module';
import { OutboxRedService }    from './outbox-red.service';
import { OutboxRedController } from './outbox-red.controller';

@Module({
  imports: [
    MikrotikModule,
    OltNativoModule,   // ProvisionFtthService para el ciclo de vida ONU
  ],
  controllers: [OutboxRedController],
  providers:   [OutboxRedService],
  exports:     [OutboxRedService],
})
export class OutboxRedModule {}
