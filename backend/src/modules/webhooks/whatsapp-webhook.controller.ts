import {
  Controller, Post, Body, Query,
  HttpCode, HttpStatus, Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SkipThrottle }   from '@nestjs/throttler';
import { Public }         from '../../common/decorators/public.decorator';
import { ApiResponse }    from '../../common/dto/response.dto';
import { WebhooksService } from './webhooks.service';

@ApiTags('Webhooks')
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(private readonly service: WebhooksService) {}

  /**
   * POST /api/v1/webhooks/whatsapp?secret=<PROCESS_WH_SECRET>
   *
   * Endpoint público (sin JWT) que recibe los eventos de tracking de
   * AutomatizadoVIP. Responde inmediatamente HTTP 200 y delega el
   * procesamiento de forma asíncrona para no bloquear al gateway.
   */
  @Post()
  @Public()
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Webhook de tracking de estado — AutomatizadoVIP' })
  handleWhatsApp(
    @Query('secret') secret: string,
    @Body() payload: unknown,
  ): ApiResponse<null> {
    const expected = process.env.PROCESS_WH_SECRET;

    if (!expected || secret !== expected) {
      throw new UnauthorizedException('Webhook secret inválido');
    }

    // Fire-and-forget: la respuesta HTTP 200 no espera la escritura en BD
    this.service
      .handleWhatsAppStatus(payload)
      .catch((err: Error) =>
        this.logger.error(`Error procesando webhook: ${err.message}`, err.stack),
      );

    return ApiResponse.ok(null, 'ok');
  }
}
