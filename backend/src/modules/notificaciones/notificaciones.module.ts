import { Module }     from '@nestjs/common';
import { HttpModule }  from '@nestjs/axios';
import { WhatsAppService }           from './services/whatsapp.service';
import { GatewayMensajeriaService }  from './services/gateway-mensajeria.service';
import { DatafastNativeStrategy }    from './services/datafast-native.strategy';
import { CrmNativoModule }           from '../crm-nativo/crm-nativo.module';

@Module({
  imports:   [HttpModule.register({ timeout: 15_000 }), CrmNativoModule],
  providers: [WhatsAppService, GatewayMensajeriaService, DatafastNativeStrategy],
  exports:   [WhatsAppService, GatewayMensajeriaService, DatafastNativeStrategy],
})
export class NotificacionesModule {}
