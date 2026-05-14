import { EventEmitterModule } from '@nestjs/event-emitter';
import { Module }          from '@nestjs/common';
import { TypeOrmModule }   from '@nestjs/typeorm';
import { HttpModule }      from '@nestjs/axios';


import { SmartoltController }    from './smartolt.controller';
import { SmartoltService }       from './smartolt.service';
import { SmartoltApiService }    from './smartolt-api.service';
import { OrquestadorFtthService } from './orquestador-ftth.service';
import { OnuRepository }         from './repositories/onu.repository';

import { Olt, Onu }              from './entities/onu.entity';
import { AuthModule }            from '../auth/auth.module';
import { MikrotikModule }        from '../mikrotik/mikrotik.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Olt, Onu]),

    // HTTP client para la API de SmartOLT
    HttpModule.register({
      timeout:     30_000,
      maxRedirects: 3,
      headers: {
        'Content-Type': 'application/json',
        'Accept':       'application/json',
        'User-Agent':   'FibraNet-ISP/1.0',
      },
    }),

    // EventEmitter para el evento 'ftth.cliente.activado'
    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: '.',
      maxListeners: 20,
      ignoreErrors: false,
    }),

    // Deps de negocio
    AuthModule,
    MikrotikModule,   // Para PPPoE, Queue, Velocidad en el flujo FTTH
  ],
  controllers: [SmartoltController],
  providers: [
    SmartoltService,
    SmartoltApiService,
    OrquestadorFtthService,
    OnuRepository,
  ],
  exports: [
    SmartoltService,
    SmartoltApiService,
    OrquestadorFtthService,
  ],
})
export class SmartoltModule {}
