import { Module } from '@nestjs/common';
import { SistemaController } from './sistema.controller';
import { SistemaService }    from './sistema.service';

@Module({
  controllers: [SistemaController],
  providers:   [SistemaService],
  exports:     [SistemaService],
})
export class SistemaModule {}
