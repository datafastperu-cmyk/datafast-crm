import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SistemaController } from './sistema.controller';
import { SistemaService }    from './sistema.service';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';

// EventosSistemaService llega vía EventosSistemaModule (@Global)
@Module({
  imports:     [TypeOrmModule.forFeature([]), NotificacionesModule],
  controllers: [SistemaController],
  providers:   [SistemaService],
  exports:     [SistemaService],
})
export class SistemaModule {}
