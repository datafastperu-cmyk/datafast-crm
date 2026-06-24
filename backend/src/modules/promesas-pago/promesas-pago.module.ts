import { Module }          from '@nestjs/common';
import { TypeOrmModule }   from '@nestjs/typeorm';

import { PromesaPago }             from './entities/promesa-pago.entity';
import { PromesasPagoService }     from './promesas-pago.service';
import { PromesasPagoController }  from './promesas-pago.controller';
import { MikrotikModule }          from '../mikrotik/mikrotik.module';
import { OutboxRedModule }         from '../outbox-red/outbox-red.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PromesaPago]),
    MikrotikModule,
    OutboxRedModule,
  ],
  controllers: [PromesasPagoController],
  providers:   [PromesasPagoService],
  exports:     [PromesasPagoService],
})
export class PromesasPagoModule {}
