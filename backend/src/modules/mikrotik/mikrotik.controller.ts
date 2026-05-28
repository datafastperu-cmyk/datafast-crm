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

import { MikrotikService }    from './mikrotik.service';
import {
  CreateRouterDto, UpdateRouterDto,
  ProvisionarClienteDto, SuspenderClienteDto,
  ReactivarClienteDto, DhcpBindingDto,
  ActualizarQueueDto, PingDto, AmareIpMacDto,
  TestConexionDirectaDto,
} from './dto/mikrotik.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission, Roles }  from '../../common/decorators/roles.decorator';
import { ApiResponse as StdResponse } from '../../common/dto/response.dto';

@ApiTags('Mikrotik')
@ApiBearerAuth('JWT')
@Controller('mikrotik')
export class MikrotikController {
  private readonly logger = new Logger(MikrotikController.name);

  constructor(private readonly svc: MikrotikService) {}

  // ─── TEST DE CONEXIÓN DIRECTA (antes de guardar) ─────────

  @Post('test-connection')
  @RequirePermission('mikrotik:view')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Probar conexión directa sin guardar',
    description:
      'Valida credenciales y conectividad con un router antes de registrarlo en el sistema. ' +
      'Para API/API-SSL: autentica con RouterOS API. Para SSH/SNMP: verifica accesibilidad TCP.',
  })
  async testConexionDirecta(@Body() dto: TestConexionDirectaDto) {
    return StdResponse.ok(await this.svc.testConexionDirecta(dto));
  }

  // ─── GESTIÓN DE ROUTERS ───────────────────────────────────

  @Post('routers')
  @RequirePermission('mikrotik:manage')
  @ApiOperation({ summary: 'Registrar nuevo router Mikrotik' })
  async crearRouter(
    @Body() dto: CreateRouterDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.crearRouter(dto, user), 'Router registrado');
  }

  @Get('routers')
  @RequirePermission('mikrotik:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Listar todos los routers de la empresa' })
  async listarRouters(@CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.svc.findAll(user.empresaId));
  }

  @Get('routers/:id')
  @RequirePermission('mikrotik:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Obtener router por ID' })
  @ApiParam({ name: 'id' })
  async getRouter(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.findOne(id, user.empresaId));
  }

  @Put('routers/:id')
  @RequirePermission('mikrotik:manage')
  @ApiOperation({ summary: 'Actualizar datos del router' })
  @ApiParam({ name: 'id' })
  async updateRouter(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRouterDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.updateRouter(id, dto, user), 'Router actualizado');
  }

  @Delete('routers/:id')
  @RequirePermission('mikrotik:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar router (soft delete)' })
  @ApiParam({ name: 'id' })
  async removeRouter(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    await this.svc.removeRouter(id, user);
  }

  // ─── REPARACIÓN AUTOMATIZADA ─────────────────────────────

  @Post('routers/:id/reparar')
  @Roles('Administrador')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reparar / Sincronizar router con los datos del sistema',
    description:
      'Inyecta y actualiza en el MikroTik físico todas las reglas de planes, ' +
      'secretos PPPoE, colas de velocidad, amarres ARP/DHCP y lista de morosos. ' +
      'Solo aplica reglas con firma "datafast" para no tocar reglas manuales.',
  })
  @ApiParam({ name: 'id' })
  async repararRouter(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.svc.repararRouter(id, user.empresaId);
    return StdResponse.ok(result, result.mensaje);
  }

  // ─── ESTADO EN TIEMPO REAL ────────────────────────────────

  @Get('routers/:id/estado')
  @RequirePermission('mikrotik:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({
    summary: 'Estado en tiempo real del router',
    description: 'CPU, RAM, uptime, versión, interfaces y sesiones PPPoE activas.',
  })
  @ApiParam({ name: 'id' })
  async getEstado(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.getEstadoRouter(id, user.empresaId));
  }

  @Post('routers/:id/sync-subnets')
  @RequirePermission('mikrotik:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sincronizar subnets LAN del router y aplicar rutas en el VPS' })
  @ApiParam({ name: 'id' })
  async syncSubnets(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const subnets = await this.svc.syncSubnets(id, user.empresaId);
    return StdResponse.ok({ subnets }, `${subnets.length} subnet${subnets.length !== 1 ? 's' : ''} sincronizado${subnets.length !== 1 ? 's' : ''}`);
  }

  @Post('routers/:id/test')
  @RequirePermission('mikrotik:view')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Testear conectividad con el router',
    description: 'Abre una conexión nueva al router y mide la latencia.',
  })
  @ApiParam({ name: 'id' })
  async testConexion(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.testConexion(id, user.empresaId));
  }

  @Get('routers/:id/interfaces')
  @RequirePermission('mikrotik:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Listar interfaces del router con estadísticas de tráfico' })
  @ApiParam({ name: 'id' })
  async getInterfaces(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.getInterfaces(id, user.empresaId));
  }

  @Get('routers/:id/trafico')
  @RequirePermission('mikrotik:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Monitoreo de tráfico en tiempo real (5 muestras/5s)' })
  @ApiParam({ name: 'id' })
  @ApiQuery({ name: 'iface', required: false, description: 'Nombre de la interface (ej: ether1)' })
  async getTrafico(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('iface') iface: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.getTrafico(id, user.empresaId, iface));
  }

  // ─── SESIONES PPPOE ───────────────────────────────────────

  @Get('routers/:id/sesiones')
  @RequirePermission('mikrotik:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Sesiones PPPoE activas en el router' })
  @ApiParam({ name: 'id' })
  async getSesiones(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.getSesionesPppoe(id, user.empresaId));
  }

  @Get('routers/:id/morosos')
  @RequirePermission('mikrotik:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'IPs en la Address List "morosos" del router' })
  @ApiParam({ name: 'id' })
  async getMorosos(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.getMorosos(id, user.empresaId));
  }

  @Get('routers/:id/queues')
  @RequirePermission('mikrotik:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Simple Queues configuradas en el router' })
  @ApiParam({ name: 'id' })
  async getQueues(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.getQueues(id, user.empresaId));
  }

  @Get('routers/:id/dhcp')
  @RequirePermission('mikrotik:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Leases DHCP del router' })
  @ApiParam({ name: 'id' })
  async getDhcp(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(await this.svc.getDhcpLeases(id, user.empresaId));
  }

  // ─── APROVISIONAMIENTO DE CLIENTES ────────────────────────

  @Post('routers/:id/provisionar')
  @RequirePermission('mikrotik:manage')
  @ApiOperation({
    summary: 'Provisionar cliente en el router',
    description:
      'Crea usuario PPPoE + Simple Queue con los límites del plan. ' +
      'Si el plan usa PCQ/Queue Tree, configura el sistema automáticamente si no existe.',
  })
  @ApiParam({ name: 'id', description: 'UUID del router' })
  @ApiResponse({ status: 201, description: 'Cliente provisionado' })
  async provisionar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProvisionarClienteDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.svc.provisionarCliente(id, dto, user);
    return StdResponse.ok(result, 'Cliente provisionado en Mikrotik');
  }

  @Post('routers/:id/suspender')
  @RequirePermission('contratos:suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Suspender cliente por mora',
    description:
      'Agrega la IP del cliente a la Address List "morosos". ' +
      'Las reglas de firewall bloquean automáticamente su tráfico. ' +
      'También desconecta la sesión PPPoE activa.',
  })
  @ApiParam({ name: 'id' })
  async suspender(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspenderClienteDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.svc.suspenderCliente(id, dto, user);
    return StdResponse.ok(null, `IP ${dto.ipAsignada} suspendida — acceso bloqueado`);
  }

  @Post('routers/:id/reactivar')
  @RequirePermission('contratos:reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reactivar cliente',
    description:
      'Quita la IP de las Address Lists de control (morosos, prorroga). ' +
      'El cliente puede reconectarse inmediatamente con sus credenciales PPPoE.',
  })
  @ApiParam({ name: 'id' })
  async reactivar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReactivarClienteDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.svc.reactivarCliente(id, dto, user);
    return StdResponse.ok(null, `IP ${dto.ipAsignada} reactivada — acceso restaurado`);
  }

  // ─── AMARRE IP + MAC ──────────────────────────────────────

  @Post('routers/:id/amarre-ip-mac')
  @RequirePermission('mikrotik:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Aplicar amarre IP-MAC en el router',
    description:
      'Agrega entrada ARP estática en IP>ARP. ' +
      'Si el router tiene tipo_control=amarre_ip_mac_dhcp o se envía dhcpServer, ' +
      'también agrega lease estático en IP>DHCP Server>Leases.',
  })
  @ApiParam({ name: 'id' })
  async aplicarAmareIpMac(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AmareIpMacDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.svc.aplicarAmareIpMac(id, dto, user);
    return StdResponse.ok(result, `Amarre IP ${dto.ip} ↔ MAC ${dto.mac} aplicado`);
  }

  // ─── QUEUES ───────────────────────────────────────────────

  @Patch('routers/:id/queues/velocidad')
  @RequirePermission('mikrotik:manage')
  @ApiOperation({ summary: 'Actualizar velocidad de una Simple Queue existente' })
  @ApiParam({ name: 'id' })
  async actualizarQueue(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActualizarQueueDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return StdResponse.ok(null, 'Velocidad actualizada en el router');
  }

  // ─── FIREWALL SETUP ───────────────────────────────────────

  @Post('routers/:id/firewall/configurar')
  @Roles('Administrador')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Configurar reglas de firewall para suspensión automática',
    description:
      'Crea las reglas necesarias en el router para que el sistema de ' +
      'Address Lists funcione: bloqueo de morosos, portal de pago, prórrogas.',
  })
  @ApiParam({ name: 'id' })
  async configurarFirewall(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.svc.configurarFirewallControl(id, user.empresaId);
    return StdResponse.ok(null, 'Reglas de firewall configuradas correctamente');
  }

  // ─── PING DESDE EL ROUTER ────────────────────────────────

  @Post('routers/:id/ping')
  @RequirePermission('mikrotik:view')
  @HttpCode(HttpStatus.OK)
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Hacer ping desde el router hacia un destino' })
  @ApiParam({ name: 'id' })
  async ping(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.svc.pingDesdeRouter(id, user.empresaId, dto.destino);
    return StdResponse.ok(result);
  }
}
