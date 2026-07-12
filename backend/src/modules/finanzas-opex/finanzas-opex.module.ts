import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EgresoIngreso } from './egreso-ingreso.entity';
import { FinanzasOpexService } from './finanzas-opex.service';
import { FinanzasOpexController } from './finanzas-opex.controller';
import { FinanzasOpexScheduler } from './finanzas-opex.scheduler';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { ConfiguracionModule } from '../config/config.module';

@Module({
  imports:     [TypeOrmModule.forFeature([EgresoIngreso]), NotificacionesModule, ConfiguracionModule],
  controllers: [FinanzasOpexController],
  providers:   [FinanzasOpexService, FinanzasOpexScheduler],
  exports:     [FinanzasOpexService],
})
export class FinanzasOpexModule {}
