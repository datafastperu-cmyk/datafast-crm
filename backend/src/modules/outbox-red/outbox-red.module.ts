import { Module }        from '@nestjs/common';

import { MikrotikModule }      from '../mikrotik/mikrotik.module';
import { OutboxRedService }    from './outbox-red.service';
import { OutboxRedController } from './outbox-red.controller';

@Module({
  imports: [
    MikrotikModule,
  ],
  controllers: [OutboxRedController],
  providers:   [OutboxRedService],
  exports:     [OutboxRedService],
})
export class OutboxRedModule {}
