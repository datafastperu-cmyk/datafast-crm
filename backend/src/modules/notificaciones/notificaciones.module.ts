import { Module, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { HttpModule, HttpService } from '@nestjs/axios';
import { BullModule } from '@nestjs/bull';
import { firstValueFrom } from 'rxjs';
import { WhatsAppService }           from './services/whatsapp.service';
import { GatewayMensajeriaService }  from './services/gateway-mensajeria.service';
import { DatafastNativeStrategy }    from './services/datafast-native.strategy';
import { CrmNativoModule }           from '../crm-nativo/crm-nativo.module';
import { NotificationEventListener }  from './listeners/notification-event.listener';
import { QUEUES } from '../workers/workers.constants';

@Injectable()
class EvolutionApiBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger('EvolutionApi');

  constructor(private readonly http: HttpService) {}

  async onApplicationBootstrap(): Promise<void> {
    const apiKey  = process.env.EVOLUTION_API_KEY;
    if (!apiKey) return;

    const baseUrl = process.env.EVOLUTION_API_URL ?? 'http://localhost:8080';

    try {
      await firstValueFrom(
        this.http.post(
          `${baseUrl}/instance/create`,
          { instanceName: 'datafast_masivos', qrcode: false, integration: 'WHATSAPP-BAILEYS' },
          { headers: { apikey: apiKey }, timeout: 5_000 },
        ),
      );
      this.logger.log('Instancia datafast_masivos registrada');
    } catch {
      // silencioso: 409 si ya existe, ECONNREFUSED si Evolution aún arrancando
    }
  }
}

@Module({
  imports:   [
    HttpModule.register({ timeout: 15_000 }),
    BullModule.registerQueue({ name: QUEUES.NOTIFICACIONES }),
    CrmNativoModule,
  ],
  providers: [
    WhatsAppService,
    GatewayMensajeriaService,
    DatafastNativeStrategy,
    EvolutionApiBootstrapService,
    NotificationEventListener,
  ],
  exports:   [WhatsAppService, GatewayMensajeriaService, DatafastNativeStrategy],
})
export class NotificacionesModule {}
