import {
  Controller, Get, Post, Body, HttpCode, HttpStatus, Logger,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApiResponse } from '../../common/dto/response.dto';
import { LicenciaService } from './licencia.service';
import { PLANES_LICENCIA } from './licencia.constants';

class ActivarLicenciaDto {
  @IsString()
  @IsNotEmpty()
  licenseKey: string;
}

@ApiTags('Licencia')
@Controller('admin/licencia')
export class LicenciaController {
  private readonly logger = new Logger(LicenciaController.name);

  constructor(private readonly licenciaSvc: LicenciaService) {}

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
  // Devuelve el machine ID de este servidor para emitir la licencia
  @Public()
  @Get('machine-id')
  @ApiOperation({ summary: 'Machine ID de este servidor (necesario para emitir licencia)' })
  getMachineId() {
    return ApiResponse.ok({ machineId: this.licenciaSvc.getMachineId() });
  }

  // ── POST /admin/licencia/activar ─────────────────────────────
  @Public()
  @Post('activar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activar o reemplazar licencia' })
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
}
