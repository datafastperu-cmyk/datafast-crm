import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EgresoIngreso } from './egreso-ingreso.entity';
import { FinanzasOpexService } from './finanzas-opex.service';
import { FinanzasOpexController } from './finanzas-opex.controller';
import { FinanzasOpexScheduler } from './finanzas-opex.scheduler';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';

@Module({
  imports:     [TypeOrmModule.forFeature([EgresoIngreso]), NotificacionesModule],
  controllers: [FinanzasOpexController],
  providers:   [FinanzasOpexService, FinanzasOpexScheduler],
  exports:     [FinanzasOpexService],
})
export class FinanzasOpexModule {}
