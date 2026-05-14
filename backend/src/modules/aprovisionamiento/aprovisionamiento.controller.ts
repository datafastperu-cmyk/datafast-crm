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

  // ── POST /aprovisionamiento/ftth ──────────────────────────
  @Post('ftth')
  @RequirePermission('onu:provision')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '🚀 Aprovisionar cliente FTTH — 8 pasos automáticos',
    description: `
Ejecuta secuencialmente los 8 pasos del flujo de aprovisionamiento FTTH:

**PASO 1** — Valida el contrato, cliente, plan, router y OLT. Carga el contexto completo.

**PASO 2** — Asigna la próxima IP disponible del pool IPv4, o usa \`ipManual\`. Si el contrato ya tiene IP, la reutiliza.

**PASO 3** — Crea el usuario PPPoE en el router Mikrotik con IP remota fija apuntando a la IP asignada.

**PASO 4** — Configura el control de velocidad: Simple Queue, Queue Tree individual o PCQ global según el plan.

**PASO 5** — Verifica/crea las reglas de firewall para el sistema de suspensión por mora (Address Lists morosos/prórroga).

**PASO 6** — Detecta la ONU en SmartOLT (automáticamente en el puerto PON, o por SN si se provee) y la aprovisiona con el perfil y VLAN del plan.

**PASO 7** — Registra la ONU en la base de datos local y la asocia al contrato.

**PASO 8** — Activa el contrato (estado → ACTIVO), envía WhatsApp de bienvenida al cliente y emite evento WebSocket.

Si algún paso falla y \`rollbackEnError=true\`, se revierte automáticamente: elimina el PPPoE, elimina la provisión en SmartOLT y libera la IP al pool.
    `,
  })
  @ApiResponse({
    status:      200,
    type:        AprovisionamientoResultadoDto,
    description: 'Resultado detallado de los 8 pasos',
  })
  @ApiResponse({ status: 400, description: 'Validación fallida en algún paso' })
  @ApiResponse({ status: 404, description: 'Contrato, router u OLT no encontrado' })
  async aprovisionar(
    @Body() dto: AprovisionarFtthDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<AprovisionamientoResultadoDto> {
    this.logger.log(
      `[FTTH] Solicitud de aprovisionamiento: contrato=${dto.contratoId} | por: ${user.email}`,
    );

    const resultado = await this.svc.ejecutar(dto, user);

    // Log resumido del resultado
    const resumen = resultado.exitoso
      ? `✅ Exitoso en ${resultado.duracionTotalMs}ms`
      : `❌ Fallido en paso ${resultado.pasosFallidos?.[0] || '?'} | rollback: ${resultado.rollbackEjecutado}`;

    this.logger.log(`[FTTH] ${resumen} | contrato=${dto.contratoId}`);

    return resultado;
  }

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
5. Revierte el estado del contrato a \`pendiente_instalacion\`

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
