import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SagaLog } from './entities/saga-log.entity';
import { SagaLogService } from './saga-log.service';

@Module({
  imports:   [TypeOrmModule.forFeature([SagaLog])],
  providers: [SagaLogService],
  exports:   [SagaLogService],
})
export class SagasModule {}
