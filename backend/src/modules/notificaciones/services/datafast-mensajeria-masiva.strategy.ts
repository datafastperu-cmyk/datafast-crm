import { Logger }        from '@nestjs/common';
import { HttpService }    from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { IMensajeriaStrategy, EnvioResult } from './gateway-mensajeria.service';

// ─────────────────────────────────────────────────────────────────────────────
// DatafastMensajeriaMasivaStrategy — DATAFAST_MENSAJERIA_MASIVA
//
// Motor HTTP puro. No toca whatsapp-web.js ni WaClientService.
// Envía texto plano a un gateway HTTP de WhatsApp propio (self-hosted).
//
// Enrutamiento dual (resuelto ANTES por GatewayMensajeriaService.resolveDestino):
//   Eventos internos  (ONU_OFFLINE, ALERTA_EGRESO)  → whatsapp_corporativo
//   Eventos de cliente (facturas, bienvenida, pagos, recordatorios) → tel. abonado
//
// Parámetros leídos de la tabla empresas:
//   gateway_client_id   → URL del endpoint HTTP del gateway WA
//   gateway_api_key     → Bearer token de autenticación (cifrado)
//   whatsapp_numero_origen → Número telefónico emisor registrado en el gateway
//   gateway_pausa          → Delay entre mensajes (aplicado por GatewayMensajeriaService)
//   gateway_limite_caracteres → Truncado de seguridad (idem)
//   gateway_codigo_pais       → Prefijo telefónico por defecto
// ─────────────────────────────────────────────────────────────────────────────
export class DatafastMensajeriaMasivaStrategy implements IMensajeriaStrategy {
  private readonly logger = new Logger(DatafastMensajeriaMasivaStrategy.name);

  constructor(
    private readonly http:          HttpService,
    private readonly apiToken:      string,
    private readonly endpointUrl:   string,
    private readonly numeroOrigen:  string,
    private readonly codigoPais:    string,
  ) {}

  async enviarMensaje(telefono: string, texto: string, _template: string): Promise<EnvioResult> {
    if (!this.endpointUrl) {
      return { enviado: false, error: 'DATAFAST_MENSAJERIA_MASIVA: endpoint HTTP no configurado (gateway_client_id)' };
    }

    const destino = this.normalizarTelefono(telefono);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiToken) headers['Authorization'] = `Bearer ${this.apiToken}`;

    const body: Record<string, string> = { to: destino, message: texto };
    if (this.numeroOrigen) body['sender'] = this.numeroOrigen;

    try {
      const res = await firstValueFrom(
        this.http.post(this.endpointUrl, body, { headers, timeout: 15_000 }),
      );
      const msgId = res.data?.id ?? res.data?.messageId ?? res.data?.data?.id;
      this.logger.log(`[DFMasivaHTTP] ✓ ${destino} (${texto.length} chars)`);
      return { enviado: true, messageId: msgId };
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? err?.response?.data?.error ?? err.message;
      this.logger.error(`[DFMasivaHTTP] Error → ${destino}: ${msg}`);
      return { enviado: false, error: msg };
    }
  }

  private normalizarTelefono(tel: string): string {
    const clean    = tel.replace(/[^\d]/g, '');
    const dialCode = this.codigoPais.replace('+', '');
    if (clean.startsWith(dialCode)) return clean;
    if (clean.length <= 10)         return `${dialCode}${clean}`;
    return clean;
  }
}
