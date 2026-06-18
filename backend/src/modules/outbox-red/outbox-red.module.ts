import { Module }        from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { MikrotikModule }  from '../mikrotik/mikrotik.module';
import { OutboxRedService } from './outbox-red.service';

@Module({
  imports: [
    ScheduleModule,
    MikrotikModule,
  ],
  providers: [OutboxRedService],
  exports:   [OutboxRedService],
})
export class OutboxRedModule {}
