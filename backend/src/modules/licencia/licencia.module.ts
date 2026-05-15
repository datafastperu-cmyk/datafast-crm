import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LicenciaEstado } from './entities/licencia-estado.entity';
import { LicenciaService } from './licencia.service';
import { LicenciaGuard } from './licencia.guard';
import { LicenciaController } from './licencia.controller';
import { LicenciaCron } from './licencia.cron';

@Global()
@Module({
  imports:     [TypeOrmModule.forFeature([LicenciaEstado])],
  controllers: [LicenciaController],
  providers:   [LicenciaService, LicenciaGuard, LicenciaCron],
  exports:     [LicenciaService, LicenciaGuard],
})
export class LicenciaModule {}
