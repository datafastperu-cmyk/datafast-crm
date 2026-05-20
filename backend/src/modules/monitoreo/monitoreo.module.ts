import { EventEmitterModule } from '@nestjs/event-emitter';
import { Module }          from '@nestjs/common';
import { TypeOrmModule }   from '@nestjs/typeorm';
import { BullModule }      from '@nestjs/bull';
import { ScheduleModule }  from '@nestjs/schedule';


import { MonitoreoController } from './monitoreo.controller';
import { MonitoreoGateway }    from './gateways/monitoreo.gateway';
import { MonitoreoWorker, MonitoreoScheduler, MONITOREO_QUEUE } from './monitoreo.worker';

import { PingService }         from './services/ping.service';
import { SnmpService }         from './services/snmp.service';
import { AlertasService }      from './services/alertas.service';
import { NodoDeviceService }   from './services/nodo-device.service';
import { MikrotikModule }      from '../mikrotik/mikrotik.module';

import {
  Nodo, MedicionNodo, Alerta, ConfiguracionAlerta,
} from './entities/monitoreo.entity';

import { AuthModule }   from '../auth/auth.module';
import { WhatsAppService } from '../notificaciones/services/whatsapp.service';
import { HttpModule }   from '@nestjs/axios';

@Module({
  imports: [
    TypeOrmModule.forFeature([Nodo, MedicionNodo, Alerta, ConfiguracionAlerta]),

    // Cola Bull para ping/SNMP/dashboard jobs
    BullModule.registerQueue({
      name: MONITOREO_QUEUE,
      defaultJobOptions: {
        attempts:         1,   // Monitoreo no reintenta — el siguiente ciclo ya lo hará
        removeOnComplete: 200,
        removeOnFail:     100,
      },
    }),

    ScheduleModule,

    // EventEmitter para comunicar alertas → gateway WebSocket
    EventEmitterModule.forRoot({
      wildcard:          false,
      delimiter:         '.',
      newListener:       false,
      removeListener:    false,
      maxListeners:      30,
      verboseMemoryLeak: false,
      ignoreErrors:      false,
    }),

    HttpModule.register({ timeout: 10_000 }),
    AuthModule,
    MikrotikModule,
  ],
  controllers: [MonitoreoController],
  providers: [
    // Services de monitoreo
    PingService,
    SnmpService,
    AlertasService,
    NodoDeviceService,

    // WhatsApp para notificaciones de alertas
    WhatsAppService,

    // WebSocket Gateway
    MonitoreoGateway,

    // Bull Worker + Scheduler
    MonitoreoWorker,
    MonitoreoScheduler,
  ],
  exports: [
    MonitoreoGateway,   // Para que otros módulos puedan hacer broadcast
    AlertasService,     // Para crear alertas desde otros módulos
    PingService,
    SnmpService,
    NodoDeviceService,
  ],
})
export class MonitoreoModule {}
