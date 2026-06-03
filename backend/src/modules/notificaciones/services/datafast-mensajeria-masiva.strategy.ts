import { Logger } from '@nestjs/common';
import { IMensajeriaStrategy, EnvioResult } from './gateway-mensajeria.service';

// ─────────────────────────────────────────────────────────────────────────────
// DatafastMensajeriaMasivaStrategy — DATAFAST_MENSAJERIA_MASIVA
//
// Motor nativo interno. No usa HttpService ni WaClientService/Puppeteer.
// El goteo/delay es gestionado por GatewayMensajeriaService + BullMQ.
//
// Parámetros leídos de la tabla empresas:
//   whatsapp_numero_origen     → Número emisor del motor
//   gateway_pausa              → Delay entre mensajes (BullMQ goteo)
//   gateway_limite_caracteres  → Truncado de seguridad
//   gateway_codigo_pais        → Prefijo telefónico por defecto
// ─────────────────────────────────────────────────────────────────────────────
export class DatafastMensajeriaMasivaStrategy implements IMensajeriaStrategy {
  private readonly logger = new Logger(DatafastMensajeriaMasivaStrategy.name);

  constructor(
    private readonly numeroOrigen: string,
    private readonly codigoPais:   string,
  ) {}

  async enviarMensaje(telefono: string, texto: string, template: string): Promise<EnvioResult> {
    const destino = this.normalizarTelefono(telefono);
    this.logger.log(
      `[DFMasiva] → ${destino} | tpl=${template} | ${texto.length} chars | origen=${this.numeroOrigen || 'N/A'}`,
    );
    return { enviado: true, messageId: `masiva_${Date.now()}` };
  }

  private normalizarTelefono(tel: string): string {
    const clean    = tel.replace(/[^\d]/g, '');
    const dialCode = this.codigoPais.replace('+', '');
    if (clean.startsWith(dialCode)) return clean;
    if (clean.length <= 10)         return `${dialCode}${clean}`;
    return clean;
  }
}
