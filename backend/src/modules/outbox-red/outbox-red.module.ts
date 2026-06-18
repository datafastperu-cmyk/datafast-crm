import { Module }        from '@nestjs/common';

import { MikrotikModule }  from '../mikrotik/mikrotik.module';
import { OutboxRedService } from './outbox-red.service';

@Module({
  imports: [
    MikrotikModule,
  ],
  providers: [OutboxRedService],
  exports:   [OutboxRedService],
})
export class OutboxRedModule {}
