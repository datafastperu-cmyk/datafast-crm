import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlantillasController } from './plantillas.controller';
import { PlantillasService } from './plantillas.service';
import { PlantillaMensaje } from './entities/plantilla-mensaje.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PlantillaMensaje])],
  controllers: [PlantillasController],
  providers: [PlantillasService],
  exports: [PlantillasService],
})
export class PlantillasModule {}
