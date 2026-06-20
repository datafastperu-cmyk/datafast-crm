import { Module }             from '@nestjs/common';
import { ReconciliadorService } from './reconciliador.service';
import { MikrotikModule }       from '../mikrotik/mikrotik.module';
import { SmartoltModule }       from '../smartolt/smartolt.module';

@Module({
  imports: [
    MikrotikModule,
    SmartoltModule,
  ],
  providers: [ReconciliadorService],
  exports:   [ReconciliadorService],
})
export class ReconciliadorModule {}
