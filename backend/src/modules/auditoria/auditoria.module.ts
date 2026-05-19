import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaController } from './auditoria.controller';
import { AuditoriaService }    from './auditoria.service';
import { EntityVersion }       from './entities/entity-version.entity';
import { AuditoriaLog }        from '../usuarios/entities/auditoria-log.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([EntityVersion, AuditoriaLog]),
  ],
  controllers: [AuditoriaController],
  providers:   [AuditoriaService],
  exports:     [AuditoriaService],
})
export class AuditoriaModule {}
