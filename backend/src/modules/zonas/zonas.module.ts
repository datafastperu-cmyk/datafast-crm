import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Zona } from './zona.entity';
import { ZonasService } from './zonas.service';
import { ZonasController } from './zonas.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Zona])],
  controllers: [ZonasController],
  providers: [ZonasService],
  exports: [ZonasService],
})
export class ZonasModule {}
