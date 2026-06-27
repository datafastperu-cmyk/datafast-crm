import { Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { IMensajeriaStrategy, EnvioResult } from './gateway-mensajeria.service';
import { normalizarTelefono } from '../../../common/utils/telefono.util';

const EVOLUTION_BASE = process.env.EVOLUTION_API_URL ?? 'http://localhost:8080';

// ─────────────────────────────────────────────────────────────────────────────
// DatafastMensajeriaMasivaStrategy — DATAFAST_MENSAJERIA_MASIVA
//
// Envía mensajes vía Evolution API (self-hosted) al instance datafast_masivos.
// Endpoint: POST {EVOLUTION_BASE}/instance/sendTextMessage/{instanceName}
// Auth: header apikey
//
// Parámetros leídos de la tabla empresas:
//   gateway_api_key            → API key de Evolution API (cifrado)
//   gateway_client_id          → Nombre de la instancia (por defecto datafast_masivos)
//   gateway_pausa              → Delay entre mensajes (BullMQ goteo)
//   gateway_limite_caracteres  → Truncado de seguridad
//   gateway_codigo_pais        → Prefijo telefónico por defecto
// ─────────────────────────────────────────────────────────────────────────────
export class DatafastMensajeriaMasivaStrategy implements IMensajeriaStrategy {
  private readonly logger = new Logger(DatafastMensajeriaMasivaStrategy.name);

  constructor(
    private readonly http:         HttpService,
    private readonly apiKey:       string,
    private readonly instanceName: string,
    private readonly codigoPais:   string,
  ) {}

  async enviarMensaje(telefono: string, texto: string, template: string): Promise<EnvioResult> {
    const number = normalizarTelefono(telefono, this.codigoPais) ?? telefono;
    const url    = `${EVOLUTION_BASE}/instance/sendTextMessage/${this.instanceName}`;

    try {
      const res = await firstValueFrom(
        this.http.post(
          url,
          { number, text: texto },
          {
            headers: {
              'apikey':       this.apiKey,
              'Content-Type': 'application/json',
            },
            timeout: 15_000,
          },
        ),
      );
      const messageId = res.data?.key?.id ?? res.data?.messageId ?? res.data?.id;
      this.logger.log(`[DFMasiva] ✓ ${number} | tpl=${template} | id=${messageId}`);
      return { enviado: true, messageId };
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? err?.response?.data?.error ?? err.message;
      this.logger.error(`[DFMasiva] ✗ ${number} | ${msg}`);
      return { enviado: false, error: msg };
    }
  }

}

