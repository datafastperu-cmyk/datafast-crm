import { Module }     from '@nestjs/common';
import { HttpModule }  from '@nestjs/axios';
import { WhatsAppService }           from './services/whatsapp.service';
import { GatewayMensajeriaService }  from './services/gateway-mensajeria.service';

@Module({
  imports:   [HttpModule.register({ timeout: 15_000 })],
  providers: [WhatsAppService, GatewayMensajeriaService],
  exports:   [WhatsAppService, GatewayMensajeriaService],
})
export class NotificacionesModule {}
