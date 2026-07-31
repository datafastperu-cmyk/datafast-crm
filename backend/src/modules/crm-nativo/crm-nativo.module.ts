import { Module }        from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrmChat }            from './entities/crm-chat.entity';
import { CrmMensaje }         from './entities/crm-mensaje.entity';
import { WaStateService }     from './wa-state.service';
import { WaClientService }    from './wa-client.service';
import { CrmNativoService }   from './crm-nativo.service';
import { CrmNativoGateway }   from './crm-nativo.gateway';
import { CrmNativoController } from './crm-nativo.controller';
import { PurgaMediaCron }     from './purga-media.cron';
import { ConfiguracionModule } from '../config/config.module';
import { AuthModule }          from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CrmChat, CrmMensaje]),
    ConfiguracionModule,
    // JwtService para autenticar el handshake del WebSocket del CRM.
    AuthModule,
  ],
  controllers: [CrmNativoController],
  providers: [
    WaStateService,
    CrmNativoService,
    CrmNativoGateway,
    WaClientService,
    PurgaMediaCron,
  ],
  exports: [WaClientService, CrmNativoService],
})
export class CrmNativoModule {}
