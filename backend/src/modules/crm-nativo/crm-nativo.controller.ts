import {
  Controller, Get, Post, Body, Param,
  HttpCode, HttpStatus, Logger,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { ApiResponse }   from '../../common/dto/response.dto';
import { WaClientService }   from './wa-client.service';
import { CrmNativoService }  from './crm-nativo.service';

class EnviarMensajeDto {
  @IsString() @IsNotEmpty()
  telefono: string;

  @IsString() @IsNotEmpty() @MaxLength(1000)
  texto: string;
}

@ApiTags('CRM Nativo — WhatsApp Web')
@ApiBearerAuth('JWT')
@Controller('crm-nativo')
export class CrmNativoController {
  private readonly logger = new Logger(CrmNativoController.name);

  constructor(
    private readonly waClient: WaClientService,
    private readonly crmSvc:   CrmNativoService,
  ) {}

  // ── GET /api/v1/crm-nativo/estado ────────────────────────────
  @Get('estado')
  @ApiOperation({ summary: 'Estado actual del cliente WhatsApp Web' })
  getEstado() {
    return ApiResponse.ok(this.waClient.getEstado());
  }

  // ── GET /api/v1/crm-nativo/chats ─────────────────────────────
  @Get('chats')
  @ApiOperation({ summary: 'Lista de chats activos' })
  async getChats(@CurrentUser() user: JwtPayload) {
    const chats = await this.crmSvc.listarChats(user.empresaId);
    return ApiResponse.ok(chats);
  }

  // ── GET /api/v1/crm-nativo/mensajes/:chatId ──────────────────
  @Get('mensajes/:chatId')
  @ApiOperation({ summary: 'Mensajes de un chat (últimos 50)' })
  async getMensajes(@Param('chatId') chatId: string) {
    const mensajes = await this.crmSvc.listarMensajes(chatId);
    return ApiResponse.ok(mensajes);
  }

  // ── POST /api/v1/crm-nativo/enviar ───────────────────────────
  @Post('enviar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enviar mensaje desde el CRM (firma del agente auto-inyectada)' })
  async enviarMensaje(
    @Body() dto: EnviarMensajeDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.waClient.enviarMensaje(
      dto.telefono,
      dto.texto,
      user.nombreCompleto,
      user.empresaId,
    );
    return ApiResponse.ok(result, 'Mensaje enviado');
  }
}
