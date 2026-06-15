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

@Module({
  imports: [
    TypeOrmModule.forFeature([Contrato, ContratoHistorial, SegmentoIpv4, IpAsignada]),
    PlanesModule,
    AuthModule,
    MikrotikModule,
    SmartoltModule,
  ],
  controllers: [ContratosController],
  providers: [ContratosService, IpPoolService, ContratoRepository],
  exports: [ContratosService, IpPoolService, ContratoRepository],
})
export class ContratosModule {}
