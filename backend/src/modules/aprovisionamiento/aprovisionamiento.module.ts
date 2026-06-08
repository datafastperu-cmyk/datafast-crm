import { Module }           from '@nestjs/common';
import { TypeOrmModule }    from '@nestjs/typeorm';
import { HttpModule }       from '@nestjs/axios';


import { AprovisionamientoController }        from './aprovisionamiento.controller';
import { OrquestadorAprovisionamientoService } from './aprovisionamiento.service';
import { MockProvisionamientoProvider }        from './providers/mock-provisionamiento.provider';

import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { AuthModule }            from '../auth/auth.module';
import { MikrotikModule }   from '../mikrotik/mikrotik.module';
import { SmartoltModule }   from '../smartolt/smartolt.module';

@Module({
  imports: [
    HttpModule.register({ timeout: 15_000 }),
    AuthModule,
    MikrotikModule,
    SmartoltModule,
    NotificacionesModule,
  ],
  controllers: [AprovisionamientoController],
  providers: [
    OrquestadorAprovisionamientoService,
    { provide: 'PROVISIONAMIENTO_PROVIDER', useClass: MockProvisionamientoProvider },
  ],
  exports: [
    OrquestadorAprovisionamientoService,
    'PROVISIONAMIENTO_PROVIDER',
  ],
})
export class AprovisionamientoModule {}
