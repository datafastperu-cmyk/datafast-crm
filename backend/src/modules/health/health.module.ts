import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [
    TerminusModule.forRoot({
      // Errores de health no deben crashear logs con stack traces
      errorLogStyle: 'json',
    }),
    HttpModule,
    TypeOrmModule,
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
