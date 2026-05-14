import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContratosController } from './contratos.controller';
import { ContratosService } from './contratos.service';
import { ContratoRepository } from './repositories/contrato.repository';
import { Contrato, ContratoHistorial } from './entities/contrato.entity';
import { SegmentoIpv4, IpAsignada } from './entities/red.entity';
import { PlanesModule } from '../planes/planes.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Contrato, ContratoHistorial, SegmentoIpv4, IpAsignada]),
    PlanesModule,
    AuthModule,
  ],
  controllers: [ContratosController],
  providers: [ContratosService, ContratoRepository],
  exports: [ContratosService, ContratoRepository],
})
export class ContratosModule {}
