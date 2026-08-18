import { Module }          from '@nestjs/common';
import { TypeOrmModule }   from '@nestjs/typeorm';

import { PromesaPago }             from './entities/promesa-pago.entity';
import { PromesasPagoService }     from './promesas-pago.service';
import { PromesasPagoController }  from './promesas-pago.controller';
import { MikrotikModule }          from '../mikrotik/mikrotik.module';
import { OutboxRedModule }         from '../outbox-red/outbox-red.module';
import { FacturacionModule }       from '../facturacion/facturacion.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PromesaPago]),
    MikrotikModule,
    OutboxRedModule,
    // Solo por FacturaRepository.contratoDe() -- el resolutor servicio->acuerdo (Ola 2,
    // Paso B). Es el mismo resolutor que usa la emisión de facturas, no uno nuevo.
    FacturacionModule,
  ],
  controllers: [PromesasPagoController],
  providers:   [PromesasPagoService],
  exports:     [PromesasPagoService],
})
export class PromesasPagoModule {}
