// Ruta: /opt/datafast/backend/src/modules/monitoreo/monitoreo.module.ts
//
// Prerequisito en AppModule:
//   import { ScheduleModule } from '@nestjs/schedule';
//   imports: [ScheduleModule.forRoot(), ..., MonitoreoModule]
//
// Instalar dependencia:
//   npm install @nestjs/schedule

import { Module }        from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DispositivoMonitoreo }    from './entities/dispositivo-monitoreo.entity';
import { MetricasMonitoreo }       from './entities/metricas-monitoreo.entity';
import { AlertaSistema }           from './entities/alerta-sistema.entity';
import { UmbralAlerta }            from './entities/umbral-alerta.entity';
import { MonitoreoController }     from './monitoreo.controller';
import { MonitoreoService }        from './monitoreo.service';
import { MonitoreoWorkerService }  from './services/monitoreo-worker.service';
import { MonitoreoGateway }        from './monitoreo.gateway';

// RouterConnectionPool vive en MikrotikModule y ya lo exporta
import { MikrotikModule }          from '../mikrotik/mikrotik.module';
// AuthModule exporta JwtModule (y por tanto JwtService) para el gateway WS
import { AuthModule }              from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DispositivoMonitoreo,
      MetricasMonitoreo,
      AlertaSistema,
      UmbralAlerta,
    ]),
    MikrotikModule, // importa RouterConnectionPool ya configurado
    AuthModule,     // provee JwtService para autenticación WebSocket
  ],
  controllers: [MonitoreoController],
  providers: [
    MonitoreoService,
    MonitoreoWorkerService,
    MonitoreoGateway,
  ],
  exports: [MonitoreoService, MonitoreoGateway],
})
export class MonitoreoModule {}
