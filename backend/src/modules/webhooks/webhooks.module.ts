import { Module } from '@nestjs/common';
import { WebhooksService }            from './webhooks.service';
import { WhatsAppWebhookController }  from './whatsapp-webhook.controller';

@Module({
  controllers: [WhatsAppWebhookController],
  providers:   [WebhooksService],
})
export class WebhooksModule {}
