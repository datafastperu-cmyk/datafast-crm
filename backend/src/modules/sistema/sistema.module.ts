import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SistemaController } from './sistema.controller';
import { SistemaService }    from './sistema.service';

@Module({
  imports:     [TypeOrmModule.forFeature([])],
  controllers: [SistemaController],
  providers:   [SistemaService],
  exports:     [SistemaService],
})
export class SistemaModule {}
