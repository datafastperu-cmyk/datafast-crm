import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContratosController } from './contratos.controller';
import { ContratosService } from './contratos.service';
import { IpPoolService } from './ip-pool.service';
import { ContratoRepository } from './repositories/contrato.repository';
import { Contrato, ContratoHistorial } from './entities/contrato.entity';
import { SegmentoIpv4, IpAsignada } from './entities/red.entity';
import { PlanesModule } from '../planes/planes.module';
import { AuthModule } from '../auth/auth.module';
import { MikrotikModule } from '../mikrotik/mikrotik.module';
import { SmartoltModule } from '../smartolt/smartolt.module';
import { XuiModule } from '../xui/xui.module';
import { SagasModule } from '../sagas/sagas.module';
import { OutboxRedModule }    from '../outbox-red/outbox-red.module';
import { PromesasPagoModule } from '../promesas-pago/promesas-pago.module';
import { DeudaPorContratoModule } from '../facturacion/deuda-por-contrato.module';
// El primer comprobante del alta se emite aquí, no en el navegador (H-3). Facturación no
// importa contratos, así que la dependencia va en un solo sentido y no hace falta forwardRef.
import { FacturacionModule } from '../facturacion/facturacion.module';

@Module({
  imports: [
    DeudaPorContratoModule,
    FacturacionModule,
    TypeOrmModule.forFeature([Contrato, ContratoHistorial, SegmentoIpv4, IpAsignada]),
    PlanesModule,
    AuthModule,
    MikrotikModule,
    SmartoltModule,
    XuiModule,
    SagasModule,
    OutboxRedModule,
    PromesasPagoModule,
  ],
  controllers: [ContratosController],
  providers: [ContratosService, IpPoolService, ContratoRepository],
  exports: [ContratosService, IpPoolService, ContratoRepository],
})
export class ContratosModule {}
