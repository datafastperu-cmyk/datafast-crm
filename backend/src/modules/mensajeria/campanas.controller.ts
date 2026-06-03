import {
  Controller, Post, Get, Delete, Body, HttpCode, HttpStatus, Logger,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { RequirePermission }  from '../../common/decorators/roles.decorator';
import { CurrentUser }        from '../../common/decorators/current-user.decorator';
import { ApiResponse }        from '../../common/dto/response.dto';
import { CrearCampanaDto }    from './dto/crear-campana.dto';
import { CampanasService }    from './campanas.service';

@ApiTags('Mensajería Masiva')
@ApiBearerAuth('JWT')
@Controller('mensajeria')
export class CampanasController {
  private readonly logger = new Logger(CampanasController.name);

  constructor(private readonly campanasService: CampanasService) {}

  @Post('campanas')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('mensajeria:masiva')
  @ApiOperation({ summary: 'Iniciar campaña masiva vía WhatsApp nativo (DATAFAST_NATIVE)' })
  async crear(
    @Body()                   dto:       CrearCampanaDto,
    @CurrentUser('empresaId') empresaId: string,
  ) {
    const result = await this.campanasService.iniciar(dto, empresaId);
    return ApiResponse.ok(
      result,
      `${result.encolados} mensajes encolados. Cuota restante hoy: ${result.cuotaRestante}`,
    );
  }

  @Get('cuota')
  @RequirePermission('mensajeria:masiva')
  @ApiOperation({ summary: 'Consultar cuota diaria de WhatsApp nativo para la empresa' })
  async cuota(@CurrentUser('empresaId') empresaId: string) {
    const result = await this.campanasService.consultarCuota(empresaId);
    return ApiResponse.ok(result);
  }

  @Get('monitor')
  @RequirePermission('mensajeria:masiva')
  @ApiOperation({ summary: 'Estadísticas de campaña activa (enviados / fallidos / encolados)' })
  async monitor(@CurrentUser('empresaId') empresaId: string) {
    const result = await this.campanasService.consultarMonitor(empresaId);
    return ApiResponse.ok(result);
  }

  @Delete('cola')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('mensajeria:masiva')
  @ApiOperation({ summary: 'Pausar / vaciar la cola de campaña masiva' })
  async pausar(@CurrentUser('empresaId') empresaId: string) {
    const result = await this.campanasService.vaciarCola(empresaId);
    return ApiResponse.ok(result, `Cola vaciada: ${result.eliminados} jobs eliminados`);
  }
}
