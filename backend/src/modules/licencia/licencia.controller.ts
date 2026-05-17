import {
  Controller, Get, Post, Body, HttpCode, HttpStatus, Logger,
  Headers, UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApiResponse } from '../../common/dto/response.dto';
import { LicenciaService } from './licencia.service';
import { PLANES_LICENCIA, MACHINE_ID_SALT } from './licencia.constants';

class ActivarLicenciaDto {
  @IsString()
  @IsNotEmpty()
  licenseKey: string;
}

class WebhookRevocarDto {
  @IsString()
  @IsNotEmpty()
  licenseId: string;

  @IsString()
  @IsNotEmpty()
  razon: string;
}

@ApiTags('Licencia')
@Controller('admin/licencia')
export class LicenciaController {
  private readonly logger = new Logger(LicenciaController.name);

  constructor(
    private readonly licenciaSvc: LicenciaService,
    private readonly config: ConfigService,
  ) {}

  // ── GET /admin/licencia/info ─────────────────────────────────
  // Ruta pública dentro del bypass — no requiere JWT ni licencia
  @Public()
  @Get('info')
  @ApiOperation({ summary: 'Estado y detalles de la licencia actual' })
  getInfo() {
    const estado = this.licenciaSvc.getEstadoActual();
    const planDef = estado.plan ? PLANES_LICENCIA[estado.plan] : null;

    return ApiResponse.ok({
      valid:         estado.valid,
      razon:         estado.razon,
      plan:          estado.plan,
      planNombre:    planDef?.nombre ?? null,
      planColor:     planDef?.color  ?? null,
      maxClientes:   estado.maxClientes,
      issuedTo:      estado.issuedTo,
      expiresAt:     estado.expiresAt,
      machineId:     estado.machineId,
      lastChecked:   estado.lastChecked,
    });
  }

  // ── GET /admin/licencia/machine-id ───────────────────────────
  // Requiere JWT Administrador — evita exposición del HWID a internet
  @ApiBearerAuth('JWT')
  @Roles('Administrador')
  @Get('machine-id')
  @ApiOperation({ summary: 'Machine ID de este servidor (necesario para emitir licencia)' })
  getMachineId() {
    return ApiResponse.ok({ machineId: this.licenciaSvc.getMachineId() });
  }

  // ── POST /admin/licencia/activar ─────────────────────────────
  // Requiere JWT (login está en bypass — el admin puede loguearse sin licencia)
  @ApiBearerAuth('JWT')
  @Roles('Administrador')
  @Post('activar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activar o reemplazar licencia (requiere Administrador)' })
  async activar(@Body() dto: ActivarLicenciaDto) {
    this.logger.log('Intentando activar nueva licencia...');
    const estado = await this.licenciaSvc.activarLicencia(dto.licenseKey);

    if (!estado.valid) {
      return ApiResponse.error(estado.razon, `Licencia inválida: ${estado.razon}`);
    }

    return ApiResponse.ok(
      {
        plan:        estado.plan,
        planNombre:  PLANES_LICENCIA[estado.plan!]?.nombre,
        maxClientes: estado.maxClientes,
        issuedTo:    estado.issuedTo,
        expiresAt:   estado.expiresAt,
      },
      'Licencia activada correctamente',
    );
  }

  // ── POST /admin/licencia/revalidar ───────────────────────────
  @ApiBearerAuth('JWT')
  @Roles('Administrador')
  @Post('revalidar')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Forzar revalidación online de la licencia' })
  async revalidar() {
    this.licenciaSvc.validarOnline().catch(() => {});
    return ApiResponse.ok(null, 'Revalidación iniciada en background');
  }

  // ── POST /admin/licencia/webhook/revocar ─────────────────────
  // Endpoint llamado por el Licensing Server para revocación push inmediata.
  // Autenticado con HMAC-SHA256 del body firmado con HEARTBEAT_SECRET.
  @Public()
  @Post('webhook/revocar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Webhook de revocación push (llamado por el Licensing Server)' })
  async webhookRevocar(
    @Body() dto: WebhookRevocarDto,
    @Headers('x-license-sig') sig: string,
  ) {
    const secret = this.config.get<string>('HEARTBEAT_SECRET') || MACHINE_ID_SALT;
    const expected = createHmac('sha256', secret).update(JSON.stringify(dto)).digest('hex');

    if (!sig || sig !== expected) {
      throw new UnauthorizedException('Firma HMAC inválida');
    }

    await this.licenciaSvc.revocarPorWebhook(dto.licenseId, dto.razon);
    this.logger.warn(`Licencia ${dto.licenseId} revocada vía webhook: ${dto.razon}`);
    return ApiResponse.ok(null, 'Revocación aplicada');
  }
}
