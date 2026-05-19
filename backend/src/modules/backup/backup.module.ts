import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Backup } from './backup.entity';
import { BackupService } from './backup.service';
import { BackupController } from './backup.controller';

@Module({
  imports:     [TypeOrmModule.forFeature([Backup])],
  controllers: [BackupController],
  providers:   [BackupService],
  exports:     [BackupService],
})
export class BackupModule {}
