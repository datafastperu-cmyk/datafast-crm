import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SistemaController } from './sistema.controller';
import { SistemaService }    from './sistema.service';
import { EventosSistemaService } from './eventos-sistema.service';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';

@Module({
  imports:     [TypeOrmModule.forFeature([]), NotificacionesModule],
  controllers: [SistemaController],
  providers:   [SistemaService, EventosSistemaService],
  exports:     [SistemaService, EventosSistemaService],
})
export class SistemaModule {}
