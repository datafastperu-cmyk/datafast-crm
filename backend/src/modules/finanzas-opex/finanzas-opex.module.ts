import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { EgresoIngreso } from './egreso-ingreso.entity';
import { FinanzasOpexService } from './finanzas-opex.service';
import { FinanzasOpexController } from './finanzas-opex.controller';
import { FinanzasOpexScheduler } from './finanzas-opex.scheduler';
import { WhatsAppService } from '../notificaciones/services/whatsapp.service';
import { GatewayMensajeriaService } from '../notificaciones/services/gateway-mensajeria.service';

@Module({
  imports:     [TypeOrmModule.forFeature([EgresoIngreso]), HttpModule],
  controllers: [FinanzasOpexController],
  providers:   [FinanzasOpexService, FinanzasOpexScheduler, WhatsAppService, GatewayMensajeriaService],
  exports:     [FinanzasOpexService],
})
export class FinanzasOpexModule {}
