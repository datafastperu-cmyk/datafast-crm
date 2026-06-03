import { Injectable, Logger, Optional } from '@nestjs/common';
import { IMensajeriaStrategy, EnvioResult } from './gateway-mensajeria.service';
import { WaClientService } from '../../crm-nativo/wa-client.service';

// ─────────────────────────────────────────────────────────────
// DatafastNativeStrategy — envía usando la sesión activa de
// whatsapp-web.js del CRM (SISTEMA 2) con simulación humana.
// ─────────────────────────────────────────────────────────────
@Injectable()
export class DatafastNativeStrategy implements IMensajeriaStrategy {
  private readonly logger = new Logger(DatafastNativeStrategy.name);

  constructor(
    @Optional() private readonly waClient: WaClientService,
  ) {}

  async enviarMensaje(telefono: string, texto: string): Promise<EnvioResult> {
    if (!this.waClient) {
      return { enviado: false, error: 'WaClientService no disponible' };
    }

    const estado = this.waClient.getEstado();
    if (estado.estado !== 'CONECTADO') {
      return { enviado: false, error: `WhatsApp no conectado (estado: ${estado.estado})` };
    }

    // Acceso al cliente raw de whatsapp-web.js para typing + sendMessage directo
    const client = (this.waClient as any).client as any;
    if (!client) {
      return { enviado: false, error: 'Cliente WhatsApp no inicializado' };
    }

    try {
      const clean  = telefono.replace(/[^\d]/g, '');
      const chatId = `${clean}@c.us`;

      // Simulación humana anti-ban: typing state + delay dinámico por longitud
      const chat    = await client.getChatById(chatId);
      await chat.sendStateTyping();
      const delayMs = Math.min(texto.length * 30, 3000);
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      await chat.clearState();

      const msg = await client.sendMessage(chatId, texto);
      this.logger.log(`[DatafastNative] ✓ ${telefono} (${texto.length} chars)`);
      return { enviado: true, messageId: msg?.id?._serialized ?? undefined };
    } catch (err: any) {
      this.logger.error(`[DatafastNative] Error → ${telefono}: ${err.message}`);
      return { enviado: false, error: err.message };
    }
  }
}
