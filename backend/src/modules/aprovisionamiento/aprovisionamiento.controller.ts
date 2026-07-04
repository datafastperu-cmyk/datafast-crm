import {
  Controller, Post, Param,
  ParseUUIDPipe, HttpCode, HttpStatus,
  Logger,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource }       from 'typeorm';
import { EventEmitter2 }    from '@nestjs/event-emitter';
import {
  ApiTags, ApiBearerAuth, ApiOperation, ApiParam,
} from '@nestjs/swagger';

import {
  NOTIFICATION_EVENTS,
  EventNotificacionBienvenida,
} from '../notificaciones/events/notification.events';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission }       from '../../common/decorators/roles.decorator';
import { ApiResponse as StdResponse } from '../../common/dto/response.dto';

@ApiTags('Aprovisionamiento FTTH')
@ApiBearerAuth('JWT')
@Controller('aprovisionamiento')
export class AprovisionamientoController {
  private readonly logger = new Logger(AprovisionamientoController.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly events: EventEmitter2,
  ) {}

  // ── POST /aprovisionamiento/notificar/:contratoId ─────────
  @Post('notificar/:contratoId')
  @RequirePermission('contratos:view')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reenviar notificación WhatsApp de bienvenida al cliente',
    description: 'Reemite el evento BIENVENIDA para el contrato indicado.',
  })
  @ApiParam({ name: 'contratoId', description: 'UUID del contrato' })
  async renotificar(
    @Param('contratoId', ParseUUIDPipe) contratoId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const [row] = await this.ds.query(`
      SELECT cl.id AS cliente_id, cl.nombre_completo, cl.telefono, cl.whatsapp,
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

    const telefono = row.whatsapp || row.telefono;
    if (!telefono) {
      return StdResponse.ok({ enviado: false }, 'El cliente no tiene teléfono/WhatsApp registrado');
    }

    this.events.emit(NOTIFICATION_EVENTS.BIENVENIDA, {
      telefono,
      clienteNombre:   row.nombre_completo,
      planNombre:      row.plan_nombre,
      velocidadBajada: String(row.velocidad_bajada ?? ''),
      velocidadSubida: String(row.velocidad_subida ?? ''),
      usuarioPppoe:    row.usuario_pppoe,
      empresaId:       user.empresaId,
      contratoId,
      clienteId:       row.cliente_id,
    } satisfies EventNotificacionBienvenida);

    this.logger.log(`[NOTIFICAR] BIENVENIDA reemitida | contrato=${contratoId} | por: ${user.email}`);
    return StdResponse.ok({ enviado: true }, 'Notificación de bienvenida reenviada');
  }
}
