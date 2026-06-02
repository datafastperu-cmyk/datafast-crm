import { EventEmitterModule } from '@nestjs/event-emitter';
import { Module }           from '@nestjs/common';
import { TypeOrmModule }    from '@nestjs/typeorm';
import { HttpModule }       from '@nestjs/axios';


import { AprovisionamientoController }        from './aprovisionamiento.controller';
import { OrquestadorAprovisionamientoService } from './aprovisionamiento.service';
import { MockProvisionamientoProvider }        from './providers/mock-provisionamiento.provider';

import { WhatsAppService }  from '../notificaciones/services/whatsapp.service';
import { AuthModule }       from '../auth/auth.module';
import { MikrotikModule }   from '../mikrotik/mikrotik.module';
import { SmartoltModule }   from '../smartolt/smartolt.module';

@Module({
  imports: [
    HttpModule.register({ timeout: 15_000 }),
    EventEmitterModule.forRoot({ wildcard: false, delimiter: '.', maxListeners: 20 }),
    AuthModule,
    MikrotikModule,
    SmartoltModule,
  ],
  controllers: [AprovisionamientoController],
  providers: [
    OrquestadorAprovisionamientoService,
    WhatsAppService,
    { provide: 'PROVISIONAMIENTO_PROVIDER', useClass: MockProvisionamientoProvider },
  ],
  exports: [
    OrquestadorAprovisionamientoService,
    WhatsAppService,
    'PROVISIONAMIENTO_PROVIDER',
  ],
})
export class AprovisionamientoModule {}
