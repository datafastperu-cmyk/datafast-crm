import {
  Controller, Post, Body, Param,
  ParseUUIDPipe, HttpCode, HttpStatus,
  Logger, Get,
} from '@nestjs/common';
import {
  ApiTags, ApiBearerAuth, ApiOperation,
  ApiResponse, ApiParam,
} from '@nestjs/swagger';

import { OrquestadorAprovisionamientoService } from './aprovisionamiento.service';
import {
  AprovisionarFtthDto,
  RollbackAprovisionamientoDto,
  AprovisionamientoResultadoDto,
} from './aprovisionamiento.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission, Roles } from '../../common/decorators/roles.decorator';
import { ApiResponse as StdResponse }         from '../../common/dto/response.dto';

@ApiTags('Aprovisionamiento FTTH')
@ApiBearerAuth('JWT')
@Controller('aprovisionamiento')
export class AprovisionamientoController {
  private readonly logger = new Logger(AprovisionamientoController.name);

  constructor(private readonly svc: OrquestadorAprovisionamientoService) {}

  // ── POST /aprovisionamiento/rollback ──────────────────────
  @Post('rollback')
  @Roles('Administrador', 'Supervisor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '↩️ Rollback de aprovisionamiento',
    description: `
Revierte un aprovisionamiento realizado (total o parcialmente):

1. Elimina la provisión de SmartOLT (si existe)
2. Elimina el usuario PPPoE del Mikrotik
3. Libera la IP al pool (ips_asignadas.activa = false)
4. Desasocia la ONU del contrato en BD
5. Revierte el estado del contrato a \`pendiente_activacion\`

Útil cuando hay un error de instalación física o se necesita mover al cliente a otro nodo.
    `,
  })
  async rollback(
    @Body() dto: RollbackAprovisionamientoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    this.logger.log(
      `[ROLLBACK] Contrato: ${dto.contratoId} | motivo: ${dto.motivo} | por: ${user.email}`,
    );

    const resultado = await this.svc.ejecutarRollback(dto, undefined, user);

    return StdResponse.ok(
      resultado,
      `Rollback completado: ${resultado.revertidos.length} acciones | ${resultado.errores.length} errores`,
    );
  }

  // ── POST /aprovisionamiento/notificar/:contratoId ─────────
  @Post('notificar/:contratoId')
  @RequirePermission('contratos:view')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reenviar notificación WhatsApp al cliente',
    description: 'Reenvía el mensaje de bienvenida al cliente del contrato indicado.',
  })
  @ApiParam({ name: 'contratoId', description: 'UUID del contrato' })
  async renotificar(
    @Param('contratoId', ParseUUIDPipe) contratoId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    // Obtener datos del contrato para la notificación
    const [row] = await this.svc['ds']?.query?.(`
      SELECT cl.nombre_completo, cl.telefono, cl.whatsapp,
             pl.nombre AS plan_nombre, pl.velocidad_bajada, pl.velocidad_subida,
             co.usuario_pppoe
      FROM contratos co
      JOIN clientes cl ON cl.id = co.cliente_id
      JOIN planes   pl ON pl.id = co.plan_id
      WHERE co.id = $1 AND co.empresa_id = $2
    `, [contratoId, user.empresaId]) || [];

    if (!row) {
      return StdResponse.ok({ enviado: false }, 'Contrato no encontrado');
    }

    const whatsapp = this.svc['whatsapp'] as any;
    const r = await whatsapp.notificarBienvenida({
      telefono:        row.whatsapp || row.telefono,
      clienteNombre:   row.nombre_completo,
      planNombre:      row.plan_nombre,
      velocidadBajada: row.velocidad_bajada,
      velocidadSubida: row.velocidad_subida,
      usuarioPppoe:    row.usuario_pppoe,
      empresaId:       user.empresaId,
    });

    return StdResponse.ok(r, r.enviado ? 'WhatsApp enviado' : `No enviado: ${r.error}`);
  }
}
