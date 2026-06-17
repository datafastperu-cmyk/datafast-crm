import {
  Controller, Post, Body, HttpCode, HttpStatus, Logger,
} from '@nestjs/common';
import {
  ApiTags, ApiBearerAuth, ApiOperation, ApiResponse,
} from '@nestjs/swagger';

import { MigracionService }    from './migracion.service';
import { MigrarWispFtthDto, MigrarFtthWispDto, MigracionResultadoDto } from './migracion.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission }   from '../../common/decorators/roles.decorator';

@ApiTags('Migración de Servicio')
@ApiBearerAuth('JWT')
@Controller('migracion')
export class MigracionController {
  private readonly logger = new Logger(MigracionController.name);

  constructor(private readonly svc: MigracionService) {}

  // ── POST /migracion/wisp-a-ftth ──────────────────────────
  @Post('wisp-a-ftth')
  @RequirePermission('contrato:migrar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '🔄 Migrar contrato WISP → FTTH (10 pasos)',
    description: `
Transición completa de un abonado radio (WISP) a fibra óptica (FTTH).

**Pasos:**
1. Validar contrato WISP y cargar recursos
2. Marcar contrato en migración (advisory lock)
3. Eliminar acceso WISP en MikroTik
4. Liberar IP WISP del pool
5. Asignar IP del pool FTTH (advisory lock)
6. Provisionar ONU en OLT (SmartOLT API o SSH nativo)
7. Registrar ONU en base de datos
8. Configurar acceso FTTH en MikroTik
9. Configurar control de velocidad (Queue)
10. Finalizar migración y recalcular tipo_servicio del cliente
    `.trim(),
  })
  @ApiResponse({ status: 200, type: MigracionResultadoDto })
  async migrarWispAFtth(
    @Body() dto: MigrarWispFtthDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<MigracionResultadoDto> {
    this.logger.log(`[MIGRACIÓN] wisp-a-ftth | contrato=${dto.contratoId} | por=${user.email}`);
    return this.svc.migrarWispAFtth(dto, user);
  }

  // ── POST /migracion/ftth-a-wisp ──────────────────────────
  @Post('ftth-a-wisp')
  @RequirePermission('contrato:migrar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '🔄 Revertir contrato FTTH → WISP (7 pasos)',
    description: `
Reversión de un abonado FTTH a radio (WISP).

**Pasos:**
1. Validar contrato FTTH
2. Marcar contrato en migración (advisory lock)
3. Desaprovisionar ONU del OLT (best-effort)
4. Eliminar acceso FTTH en MikroTik
5. Liberar IP FTTH del pool
6. Asignar IP del pool WISP (advisory lock)
7. Finalizar: actualizar contrato a WISP, recalcular tipo_servicio del cliente
    `.trim(),
  })
  @ApiResponse({ status: 200, type: MigracionResultadoDto })
  async migrarFtthAWisp(
    @Body() dto: MigrarFtthWispDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<MigracionResultadoDto> {
    this.logger.log(`[MIGRACIÓN] ftth-a-wisp | contrato=${dto.contratoId} | por=${user.email}`);
    return this.svc.migrarFtthAWisp(dto, user);
  }
}
