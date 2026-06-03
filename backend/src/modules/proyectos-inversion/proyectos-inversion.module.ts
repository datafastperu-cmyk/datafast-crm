import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProyectoInversion } from './proyecto-inversion.entity';
import { ProyectosInversionService } from './proyectos-inversion.service';
import { ProyectosInversionController } from './proyectos-inversion.controller';

@Module({
  imports:     [TypeOrmModule.forFeature([ProyectoInversion])],
  controllers: [ProyectosInversionController],
  providers:   [ProyectosInversionService],
  exports:     [ProyectosInversionService],
})
export class ProyectosInversionModule {}
