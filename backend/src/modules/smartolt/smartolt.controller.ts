import {
  Controller, Get, Post, Put, Patch, Delete,
  Body, Param, Query, Req,
  ParseUUIDPipe, HttpCode, HttpStatus,
  SetMetadata, Logger,
} from '@nestjs/common';
import {
  ApiTags, ApiBearerAuth, ApiOperation,
  ApiResponse, ApiParam, ApiQuery,
} from '@nestjs/swagger';
import { Request } from 'express';

import { SmartoltService }       from './smartolt.service';
import { OrquestadorFtthService } from './orquestador-ftth.service';
import {
  CreateOltDto, UpdateOltDto, ProvisionarOnuDto,
  AsociarOnuContratoDto, FilterOnuDto, FlujoComipletoFtthDto,
} from './dto/smartolt.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission, Roles } from '../../common/decorators/roles.decorator';
import { ApiResponse as StdResponse } from '../../common/dto/response.dto';

@ApiTags('FTTH — SmartOLT')
@ApiBearerAuth('JWT')
@Controller('smartolt')
export class SmartoltController {
  private readonly logger = new Logger(SmartoltController.name);

  constructor(
    private readonly svc:          SmartoltService,
    private readonly orquestador:  OrquestadorFtthService,
  ) {}

  // ─── SALUD / CONECTIVIDAD ─────────────────────────────────

  @Get('health')
  @RequirePermission('onu:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Verificar conectividad con SmartOLT' })
  async health(@CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.svc.verificarSmartolt());
  }

  // ─── OLTs ────────────────────────────────────────────────

  @Post('olts')
  @RequirePermission('onu:provision')
  @ApiOperation({ summary: 'Registrar un OLT en el sistema' })
  async crearOlt(@Body() dto: CreateOltDto, @CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.svc.crearOlt(dto, user), 'OLT registrado');
  }

  @Get('olts')
  @RequirePermission('onu:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Listar OLTs de la empresa' })
  async listarOlts(@CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.svc.findAllOlts(user.empresaId));
  }

  @Get('olts/:id')
  @RequirePermission('onu:view')
  @SetMetadata('skipAudit', true)
  @ApiParam({ name: 'id' })
  async getOlt(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.findOneOlt(id, user.empresaId));
  }

  @Put('olts/:id')
  @RequirePermission('onu:provision')
  @ApiParam({ name: 'id' })
  async updateOlt(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOltDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.updateOlt(id, dto, user), 'OLT actualizado');
  }

  @Post('olts/sincronizar')
  @Roles('Administrador', 'Supervisor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sincronizar OLTs desde SmartOLT',
    description: 'Importa todos los OLTs registrados en SmartOLT al sistema.',
  })
  async sincronizarOlts(@CurrentUser() user: JwtPayload) {
    const r = await this.svc.sincronizarOltsDesdeSmartolt(user);
    return StdResponse.ok(r, `${r.sincronizados} OLTs sincronizados`);
  }

  @Get('olts/:id/estadisticas')
  @RequirePermission('onu:view')
  @SetMetadata('skipAudit', true)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Estadísticas del OLT en SmartOLT (ONUs online/offline, potencia)' })
  async getEstadisticasOlt(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const olt = await this.svc.findOneOlt(id, user.empresaId);
    const stats = await this.svc['smartoltApi']?.getEstadisticasOlt?.(olt.smartoltId || '').catch(() => null);
    return StdResponse.ok(stats);
  }

  // ─── ONUs NO APROVISIONADAS ───────────────────────────────

  @Get('onus/sin-aprovisionar')
  @RequirePermission('onu:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({
    summary: 'ONUs detectadas sin aprovisionar',
    description: 'Consulta SmartOLT y retorna ONUs conectadas pero sin perfil. Filtrar por OLT.',
  })
  @ApiQuery({ name: 'oltId', required: false })
  async listarNoAprovisionadas(
    @Query('oltId') oltId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.listarNoAprovisionadas(user.empresaId, oltId));
  }

  // ─── APROVISIONAMIENTO ────────────────────────────────────

  @Post('onus/provisionar')
  @RequirePermission('onu:provision')
  @ApiOperation({
    summary: 'Aprovisionar una ONU individual',
    description:
      'Registra la ONU en SmartOLT con SN, PON, perfil y VLAN. ' +
      'Luego la guarda en la BD y la asocia al contrato si se indica.',
  })
  @ApiResponse({ status: 201, description: 'ONU aprovisionada' })
  @ApiResponse({ status: 409, description: 'ONU ya aprovisionada con ese SN' })
  async provisionar(
    @Body() dto: ProvisionarOnuDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const onu = await this.svc.aprovisionarOnu(dto, user, req);
    return StdResponse.ok(onu, `ONU ${dto.serialNumber} aprovisionada correctamente`);
  }

  // ─── FLUJO COMPLETO FTTH (los 8 pasos) ───────────────────

  @Post('ftth/aprovisionamiento-completo')
  @RequirePermission('onu:provision')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '🚀 Flujo completo FTTH — 8 pasos automáticos',
    description: `Ejecuta secuencialmente:
1. Validar contrato, cliente y plan
2. Asignar IP del pool (si no tiene)
3. Detectar ONU no aprovisionada en SmartOLT
4. Aprovisionar ONU (SN + PON + perfil + VLAN)
5. Registrar ONU en BD y asociar al contrato
6. Crear usuario PPPoE en Mikrotik
7. Aplicar control de velocidad (Simple Queue / Queue Tree / PCQ)
8. Activar contrato y notificar al cliente por WhatsApp

Si algún paso falla, los siguientes se marcan como omitidos y el resultado incluye el detalle del error.`,
  })
  @ApiResponse({ status: 200, description: 'Resultado de los 8 pasos del flujo FTTH' })
  async flujoCompleto(
    @Body() dto: FlujoComipletoFtthDto,
    @CurrentUser() user: JwtPayload,
  ) {
    this.logger.log(`Flujo FTTH iniciado: contrato=${dto.contratoId} | por: ${user.email}`);
    const resultado = await this.orquestador.ejecutarFlujoComipletoFtth(dto, user);
    return StdResponse.ok(resultado, resultado.mensajeFinal);
  }

  // ─── GESTIÓN DE ONUs ──────────────────────────────────────

  @Get('onus')
  @RequirePermission('onu:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Listar ONUs con filtros y paginación' })
  async findAll(
    @Query() filters: FilterOnuDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const r = await this.svc.findAll(user.empresaId, filters);
    return StdResponse.ok(r.data, 'ONUs obtenidas', { meta: r.meta });
  }

  @Get('onus/resumen')
  @RequirePermission('onu:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Resumen de ONUs por estado' })
  async getResumen(@CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.svc.getResumen(user.empresaId));
  }

  @Get('onus/:id')
  @RequirePermission('onu:view')
  @SetMetadata('skipAudit', true)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Datos completos de una ONU (con OLT, contrato y cliente)' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.findOnuCompleta(id, user.empresaId));
  }

  @Get('onus/:id/senal')
  @RequirePermission('onu:view')
  @SetMetadata('skipAudit', true)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Señal óptica en tiempo real (dBm, temperatura, voltaje)' })
  async getSeñal(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.getSeñalOnu(id, user.empresaId));
  }

  @Post('onus/:id/reiniciar')
  @RequirePermission('onu:provision')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Reiniciar una ONU remotamente' })
  async reiniciar(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.svc.reiniciarOnu(id, user);
    return StdResponse.ok(null, 'ONU reiniciada');
  }

  @Post('onus/:id/eliminar-provision')
  @RequirePermission('onu:provision')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Eliminar provisión de la ONU en SmartOLT',
    description: 'Desasocia la ONU del contrato y la elimina del OLT en SmartOLT. La ONU queda "sin aprovisionar".',
  })
  async eliminarProvision(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    await this.svc.eliminarProvision(id, user, req);
    return StdResponse.ok(null, 'Provisión eliminada — ONU queda disponible para re-aprovisionar');
  }

  @Post('onus/asociar-contrato')
  @RequirePermission('onu:provision')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Asociar ONU existente a un contrato' })
  async asociarContrato(
    @Body() dto: AsociarOnuContratoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.svc.asociarAContrato(dto, user);
    return StdResponse.ok(null, `ONU ${dto.onuId} asociada al contrato ${dto.contratoId}`);
  }

  @Post('onus/sincronizar/:oltId')
  @RequirePermission('onu:provision')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'oltId' })
  @ApiOperation({
    summary: 'Sincronizar estado de ONUs desde SmartOLT',
    description: 'Actualiza el estado online/offline y señal óptica de todas las ONUs del OLT.',
  })
  async sincronizarEstado(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const r = await this.svc.sincronizarEstadoOnus(user.empresaId, oltId);
    return StdResponse.ok(r, `${r.actualizadas} ONUs sincronizadas: ${r.online} online, ${r.offline} offline`);
  }

  // ─── PERFILES SMARTOLT ────────────────────────────────────

  @Get('perfiles')
  @RequirePermission('onu:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Listar perfiles de servicio disponibles en SmartOLT' })
  async listarPerfiles(@CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.svc.listarPerfiles());
  }
}
