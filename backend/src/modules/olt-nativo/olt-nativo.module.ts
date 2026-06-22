import { Module }           from '@nestjs/common';
import { TypeOrmModule }    from '@nestjs/typeorm';
import { HttpModule }       from '@nestjs/axios';
import { MulterModule }     from '@nestjs/platform-express';
import { memoryStorage }    from 'multer';

import { OltDispositivo }      from './entities/olt-dispositivo.entity';
import { OltProveedorConfig }  from './entities/olt-proveedor-config.entity';
import { OltOperacionLog }     from './entities/olt-operacion-log.entity';
import { MetricasOnuOptical }  from './entities/metricas-onu-optical.entity';
import { HistorialFirmware }   from './entities/historial-firmware.entity';
import { Onu }                 from '../smartolt/entities/onu.entity';
import { AlertaSistema }       from '../monitoreo/entities/alerta-sistema.entity';
import { SmartoltModule }      from '../smartolt/smartolt.module';

import { OltAutomationClient }   from './olt-automation.client';
import { OltNativoService }      from './olt-nativo.service';
import { OltNativoController }   from './olt-nativo.controller';
import { OltMonitoreoService }   from './olt-monitoreo.service';
import { FirmwareService }       from './firmware.service';
import { CircuitBreakerService } from './services/circuit-breaker.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OltDispositivo,
      OltProveedorConfig,
      OltOperacionLog,
      Onu,
      MetricasOnuOptical,
      AlertaSistema,
      HistorialFirmware,
    ]),

    // HTTP client para el microservicio Python
    HttpModule.register({
      timeout:      30_000,
      maxRedirects: 2,
      headers: {
        'Content-Type': 'application/json',
        'Accept':       'application/json',
      },
    }),

    // Multer en memoria — el buffer no toca disco hasta que FirmwareService lo escribe
    MulterModule.register({ storage: memoryStorage() }),

    SmartoltModule,
  ],
  controllers: [OltNativoController],
  providers: [
    // Infraestructura
    OltAutomationClient,
    CircuitBreakerService,
    // Servicios de dominio
    OltNativoService,
    OltMonitoreoService,
    FirmwareService,
  ],
  exports: [OltNativoService, OltAutomationClient, CircuitBreakerService],
})
export class OltNativoModule {}
