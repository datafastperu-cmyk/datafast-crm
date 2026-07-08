import {
  BadRequestException,
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Query,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { EventEmitter2 }        from '@nestjs/event-emitter';
import { TipoProveedor } from './entities/olt-proveedor-config.entity';
import { FileInterceptor }      from '@nestjs/platform-express';
import { memoryStorage }        from 'multer';
import {
  ApiBody, ApiConsumes, ApiOperation, ApiParam,
  ApiQuery, ApiResponse, ApiTags,
} from '@nestjs/swagger';

import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { OltNativoService }        from './olt-nativo.service';
import { FirmwareService }         from './firmware.service';
import {
  CambiarVelocidadDto,
  DesaprovisionarFtthDto,
  FtthProvisionResult,
  ProvisionarFtthDto,
  ProvisionFtthService,
  ReinjectarWanDto,
} from './services/provision-ftth.service';
import { WizardCommitDto } from './dto/olt-nativo-ops.dto';
import { OltHealthDashboardService } from './services/olt-health-dashboard.service';
import {
  ConfigurarPoolDto,
  EstadoPool,
  OltServicePortPoolService,
} from './services/olt-service-port-pool.service';
import { OltOnuIdPoolService } from './services/olt-onu-id-pool.service';
import { AgregarVlanDto, OltVlanService }         from './services/olt-vlan.service';
import { AgregarTrafficTableDto, EditarTrafficTableDto, OltTrafficTableService } from './services/olt-traffic-table.service';
import { OltVlan }           from './entities/olt-vlan.entity';
import { OltTrafficTable }   from './entities/olt-traffic-table.entity';
import { OltSyncService }    from './services/olt-sync.service';
import { OltBoard }          from './entities/olt-board.entity';
import { OltLineProfile }    from './entities/olt-line-profile.entity';
import { OltServiceProfile } from './entities/olt-service-profile.entity';
import { OltSyncJob }        from './entities/olt-sync-job.entity';
import { OltOperacionLog }   from './entities/olt-operacion-log.entity';
import { FtthOnuRegistro }         from './entities/ftth-onu-registro.entity';
import {
  CrearOltIntegracionDto,
  DiscoverOnusQueryDto,
  ClasificarOnusQueryDto,
  DiscoverResult,
  FirmwareJobResult,
  IniciarFirmwareUpgradeDto,
  MetricasOnuResult,
  ObtenerMetricasDto,
  OnuActivaInfo,
  ProvisionarOnuNativaDto,
  ProvisionResult,
  UpsertProveedorOltDto,
} from './dto/olt-nativo-ops.dto';
import { CreateOltDispositivoDto, UpdateOltDispositivoDto } from './dto/olt-dispositivo.dto';

@ApiTags('OLT Nativo')
@Controller('olt-nativo')
export class OltNativoController {

  constructor(
    private readonly service:       OltNativoService,
    private readonly firmware:      FirmwareService,
    private readonly ftth:          ProvisionFtthService,
    private readonly pool:          OltServicePortPoolService,
    private readonly onuIdPool:     OltOnuIdPoolService,
    private readonly oltVlans:      OltVlanService,
    private readonly trafficTables: OltTrafficTableService,
    private readonly healthDash:    OltHealthDashboardService,
    private readonly sync:          OltSyncService,
    private readonly events:        EventEmitter2,
  ) {}

  // ────────────────────────────────────────────────────────────
  // Listar OLTs nativas de la empresa
  // ────────────────────────────────────────────────────────────
  @Get()
  @ApiOperation({ summary: 'Listar OLTs nativas activas de la empresa' })
  async listar(@CurrentUser() user: JwtPayload) {
    return this.service.listar(user.empresaId);
  }

  // ── GET /olt-nativo/todas — todas las OLTs para /red/olt ─────
  // Debe declararse ANTES de :oltId para que NestJS no parsee
  // "todas" como UUID param.
  @Get('todas')
  @ApiOperation({ summary: 'Listar todas las OLTs con proveedor principal (para /red/olt)' })
  async listarTodas(@CurrentUser() user: JwtPayload) {
    return this.service.listarTodas(user.empresaId);
  }

  // ── GET /olt-nativo/validar-ip — check disponibilidad de IP ──
  @Get('validar-ip')
  @ApiOperation({ summary: 'Verificar si una IP de gestión está disponible en la empresa' })
  @ApiQuery({ name: 'ip', description: 'IP a verificar (formato inet)' })
  async validarIp(
    @Query('ip') ip: string,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!ip) throw new BadRequestException('Parámetro ip requerido');
    return this.service.validarIp(ip, user.empresaId);
  }

  @Get(':oltId')
  @ApiParam({ name: 'oltId', description: 'UUID de la OLT' })
  async findOne(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.findOne(oltId, user.empresaId);
  }

  @Post()
  @ApiOperation({ summary: 'Registrar nueva OLT' })
  @ApiResponse({ status: 201, description: 'OLT creada' })
  async crear(
    @Body() dto: CreateOltDispositivoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.crear(user.empresaId, dto);
  }

  // ── POST /olt-nativo/integraciones/smartolt ───────────────────
  @Post('integraciones/smartolt')
  @ApiOperation({ summary: 'Crear OLT vía SmartOLT (crea dispositivo + config de proveedor en una transacción)' })
  async crearSmartolt(
    @Body() dto: CrearOltIntegracionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.crearConProveedor(user.empresaId, 'smartolt', dto);
  }

  // ── POST /olt-nativo/integraciones/adminolt ───────────────────
  @Post('integraciones/adminolt')
  @ApiOperation({ summary: 'Crear OLT vía AdminOLT (crea dispositivo + config de proveedor en una transacción)' })
  async crearAdminolt(
    @Body() dto: CrearOltIntegracionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.crearConProveedor(user.empresaId, 'adminolt', dto);
  }

  @Put(':oltId')
  @ApiOperation({ summary: 'Actualizar OLT' })
  @ApiParam({ name: 'oltId', description: 'UUID de la OLT' })
  async actualizar(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @Body() dto: UpdateOltDispositivoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.actualizar(oltId, user.empresaId, dto);
  }

  @Delete(':oltId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar OLT (soft delete)' })
  @ApiParam({ name: 'oltId', description: 'UUID de la OLT' })
  async eliminar(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    return this.service.eliminar(oltId, user.empresaId);
  }

  // ────────────────────────────────────────────────────────────
  // POST /olt-nativo/:oltId/provision
  //
  // Orquesta el aprovisionamiento según metodoConexion de la OLT:
  //   SMARTOLT_API → SmartoltApiService
  //   NATIVO_SSH   → Python microservice (SSH directo vía VPN)
  // ────────────────────────────────────────────────────────────
  @Post(':oltId/provision')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Aprovisionar ONU en OLT nativa (SSH directo o SmartOLT API)' })
  @ApiParam({ name: 'oltId', description: 'UUID de la OltDispositivo' })
  @ApiResponse({ status: 200, description: 'ONU aprovisionada correctamente' })
  @ApiResponse({ status: 404, description: 'OLT no encontrada' })
  @ApiResponse({ status: 502, description: 'Fallo de comunicación SSH con la OLT' })
  @ApiResponse({ status: 503, description: 'Microservicio Python no disponible' })
  async provision(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @Body() dto: ProvisionarOnuNativaDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<ProvisionResult> {
    return this.service.provisionarOnuNativa(oltId, user.empresaId, dto);
  }

  // ────────────────────────────────────────────────────────────
  // GET /olt-nativo/:oltId/metrics
  //
  // Consulta métricas ópticas en tiempo real.
  // Siempre responde con 200 — nunca 5xx al frontend.
  // Si hay fallo de red devuelve: { status: 'offline', metricsAvailable: false }
  // ────────────────────────────────────────────────────────────
  @Get(':oltId/metrics')
  @ApiOperation({
    summary: 'Obtener métricas ópticas de una ONU (RxPower, TxPower, Temperatura)',
    description:
      'Consulta en tiempo real via SSH. Si la OLT no responde retorna ' +
      '{ status: "offline", metricsAvailable: false } sin errores HTTP.',
  })
  @ApiParam({ name: 'oltId', description: 'UUID de la OltDispositivo' })
  @ApiResponse({
    status: 200,
    description: 'Métricas obtenidas o estado offline controlado',
  })
  async metrics(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @Query() dto: ObtenerMetricasDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<MetricasOnuResult> {
    return this.service.obtenerMetricasOnuNativa(oltId, user.empresaId, dto);
  }

  // ────────────────────────────────────────────────────────────
  // GET /olt-nativo/:oltId/discover-onus
  //
  // Retorna ONUs no autorizadas / no configuradas en la OLT.
  // Siempre 200 — { success: false, total: 0, onus: [] } en error.
  // ────────────────────────────────────────────────────────────
  @Get(':oltId/discover-onus')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Descubrir ONUs no autorizadas en un puerto PON (Auto-Find)',
    description:
      'Ejecuta display ont autofind all (Huawei) o show gpon onu unconfigured (ZTE) ' +
      'vía SSH y retorna la lista de seriales pendientes de aprovisionamiento.',
  })
  @ApiParam({ name: 'oltId', description: 'UUID de la OltDispositivo' })
  @ApiResponse({ status: 200, description: 'Lista de ONUs detectadas (puede ser vacía)' })
  async discoverOnus(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @Query() dto: DiscoverOnusQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<DiscoverResult> {
    return this.service.buscarOnusNoAutorizadas(oltId, user.empresaId, dto.slot, dto.port);
  }

  // ────────────────────────────────────────────────────────────
  // GET /olt-nativo/:oltId/onus?slot=&port=
  //
  // Clasifica el estado de TODAS las ONUs de un puerto PON, cruzado con
  // contratos: online | apagada | ruptura_fibra | desactivada | offline |
  // no_aprovisionada, + bandera sinContrato.
  // ────────────────────────────────────────────────────────────
  @Get(':oltId/onus')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Clasificar estado de las ONUs de un puerto PON',
    description:
      'Combina display ont info + detalle de las offline (down cause) + autofind, ' +
      'y cruza los seriales con los contratos FTTH para marcar las ONUs sin contrato.',
  })
  @ApiParam({ name: 'oltId', description: 'UUID de la OltDispositivo' })
  @ApiResponse({ status: 200, description: 'Lista de ONUs clasificadas (puede ser vacía)' })
  async clasificarOnus(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @Query() dto: ClasificarOnusQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.clasificarOnus(oltId, user.empresaId, dto.slot, dto.port);
  }

  // ────────────────────────────────────────────────────────────
  // POST /olt-nativo/test-conexion-directa
  // Prueba SSH con credenciales del formulario (antes de guardar)
  // ────────────────────────────────────────────────────────────
  @Post('test-conexion-directa')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Probar conexión SSH a la OLT con credenciales en crudo (pre-guardado)' })
  async testConexionDirecta(
    @Body() body: { ip: string; puerto: number; usuario: string; password: string; marca: string; oltId?: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.testConexionDirecta(user.empresaId, body);
  }

  // ────────────────────────────────────────────────────────────
  // POST /olt-nativo/wizard/topology
  // Obtener topología completa de la OLT con credenciales en crudo
  // ────────────────────────────────────────────────────────────
  @Post('wizard/topology')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Wizard OLT: obtener topología completa (boards, VLANs, perfiles, traffic tables)' })
  async wizardTopologia(
    @Body() body: { ip: string; puerto: number; usuario: string; contrasena: string; marca: string },
    @CurrentUser() _user: JwtPayload,
  ) {
    return this.service.wizardTopologia(body);
  }

  // ────────────────────────────────────────────────────────────
  // POST /olt-nativo/wizard/commit
  // Transacción atómica: crea OLT + proveedor SSH + sincroniza
  // VLANs y traffic tables en una sola llamada
  // ────────────────────────────────────────────────────────────
  @Post('wizard/commit')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Wizard OLT: commit atómico — crea OLT nativa + proveedor SSH + topología inicial' })
  async wizardCommit(
    @Body() dto: WizardCommitDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ oltId: string; vlans?: unknown; trafficTables?: unknown }> {
    const { oltId } = await this.service.wizardCommit(user.empresaId, dto);

    let vlansResult: unknown = null;
    let trafficResult: unknown = null;

    if (dto.vlans?.length) {
      vlansResult = await this.oltVlans.sincronizarDesdeArray(oltId, user.empresaId, dto.vlans);
    }
    if (dto.trafficTables?.length) {
      trafficResult = await this.trafficTables.sincronizarDesdeOlt(
        oltId, user.empresaId,
        dto.trafficTables.map(t => ({
          index: t.index, name: t.name,
          cir_kbps: t.cir_kbps ?? null, pir_kbps: t.pir_kbps ?? null,
        })),
      );
    }

    return { oltId, vlans: vlansResult ?? undefined, trafficTables: trafficResult ?? undefined };
  }

  // ────────────────────────────────────────────────────────────
  // POST /olt-nativo/:oltId/test-conexion
  // Prueba SSH con credenciales almacenadas en BD
  // ────────────────────────────────────────────────────────────
  @Post(':oltId/test-conexion')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Probar conexión SSH a una OLT guardada (usa credenciales en BD)' })
  @ApiParam({ name: 'oltId', description: 'UUID de la OLT' })
  async testConexion(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.testConexion(oltId, user.empresaId);
  }

  // ────────────────────────────────────────────────────────────
  // GET /olt-nativo/:oltId/verify-onu
  // Verifica el estado de una ONU post-aprovisionamiento vía SSH
  // ────────────────────────────────────────────────────────────
  @Get(':oltId/verify-onu')
  @ApiOperation({ summary: 'Verificar estado ONU post-aprovisionamiento (SSH → OLT nativo)' })
  @ApiParam({ name: 'oltId', description: 'UUID de la OLT' })
  @ApiQuery({ name: 'slot',  type: Number })
  @ApiQuery({ name: 'port',  type: Number })
  @ApiQuery({ name: 'onuId', type: Number })
  async verificarOnu(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @Query('slot',  ParseIntPipe)  slot:  number,
    @Query('port',  ParseIntPipe)  port:  number,
    @Query('onuId', ParseIntPipe)  onuId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.verificarOnu(oltId, user.empresaId, slot, port, onuId);
  }

  // ────────────────────────────────────────────────────────────
  // GET /olt-nativo/automation/health
  // Verifica que el microservicio Python esté en línea
  // ────────────────────────────────────────────────────────────
  @Get('automation/health')
  @ApiOperation({ summary: 'Verificar disponibilidad del microservicio Python de automatización' })
  async automationHealth() {
    return this.service.automationHealth();
  }

  // ═══════════════════════════════════════════════════════════════
  //  GESTIÓN DE PROVEEDORES MULTI-PROVEEDOR
  // ═══════════════════════════════════════════════════════════════

  // Debe declararse ANTES de :oltId/proveedores para que NestJS
  // lo resuelva como ruta literal y no como param UUID.
  @Get('proveedores/resumen')
  @ApiOperation({ summary: 'Resumen de salud de proveedores por OLT (una sola query, sin N+1)' })
  async resumenProveedores(@CurrentUser() user: JwtPayload) {
    return this.service.resumenProveedores(user.empresaId);
  }

  @Get('proveedores/por-tipo')
  @ApiOperation({ summary: 'Listar todas las configs de un tipo de proveedor (smartolt, adminolt…)' })
  @ApiQuery({ name: 'tipo', enum: ['nativo_ssh', 'nativo_snmp', 'smartolt', 'adminolt'] })
  async listarPorTipo(
    @Query('tipo') tipo: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const TIPOS: TipoProveedor[] = ['nativo_ssh', 'nativo_snmp', 'smartolt', 'adminolt'];
    if (!TIPOS.includes(tipo as TipoProveedor)) {
      throw new BadRequestException(`tipo inválido: ${tipo}`);
    }
    return this.service.listarPorTipo(tipo as TipoProveedor, user.empresaId);
  }

  @Post('proveedores/:configId/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Probar conectividad de una config de proveedor específica' })
  @ApiParam({ name: 'configId', description: 'UUID de OltProveedorConfig' })
  async testProveedor(
    @Param('configId', ParseUUIDPipe) configId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ exitoso: boolean; mensaje: string; latenciaMs: number }> {
    return this.service.testProveedorConexion(configId, user.empresaId);
  }

  @Get('smartolt/:configId/lookup')
  @ApiOperation({ summary: 'Listar datos de referencia SmartOLT: perfiles, vlans, zonas, odbs, tipos-onu' })
  @ApiParam({ name: 'configId', description: 'UUID de OltProveedorConfig tipo smartolt' })
  @ApiQuery({ name: 'tipo', enum: ['perfiles', 'vlans', 'zonas', 'odbs', 'tipos-onu'] })
  async smartoltLookup(
    @Param('configId', ParseUUIDPipe) configId: string,
    @Query('tipo') tipo: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<unknown[]> {
    const TIPOS = ['perfiles', 'vlans', 'zonas', 'odbs', 'tipos-onu'] as const;
    if (!TIPOS.includes(tipo as any)) {
      throw new BadRequestException(`tipo inválido: ${tipo}`);
    }
    return this.service.listarLookupSmartolt(
      tipo as 'perfiles' | 'vlans' | 'zonas' | 'odbs' | 'tipos-onu',
      configId,
      user.empresaId,
    );
  }

  @Get(':oltId/proveedores')
  @ApiOperation({ summary: 'Listar configuraciones de proveedor para una OLT' })
  @ApiParam({ name: 'oltId' })
  async listarProveedores(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.listarProveedores(oltId, user.empresaId);
  }

  @Post(':oltId/proveedores')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Crear o actualizar proveedor de una OLT (upsert por tipo)' })
  @ApiParam({ name: 'oltId' })
  async upsertProveedor(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @Body() dto: UpsertProveedorOltDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.upsertProveedor(oltId, user.empresaId, dto);
  }

  @Post('proveedores/:configId/reset-circuit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Resetear circuit breaker de un proveedor a estado CLOSED' })
  @ApiParam({ name: 'configId', description: 'UUID de OltProveedorConfig' })
  async resetCircuit(
    @Param('configId', ParseUUIDPipe) configId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    return this.service.resetCircuit(configId, user.empresaId);
  }

  // ═══════════════════════════════════════════════════════════════
  //  OPERACIONES MA5800: PERFILES, RESET, TOPOLOGÍA, VERSIÓN
  // ═══════════════════════════════════════════════════════════════

  @Get(':oltId/profiles')
  @ApiOperation({ summary: 'Listar perfiles de la OLT Huawei MA5800 (lineprofile, srvprofile, traffic-table)' })
  @ApiParam({ name: 'oltId' })
  async listarPerfiles(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.listarPerfilesOlt(oltId, user.empresaId);
  }

  @Post(':oltId/ont-reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reiniciar una ONU en la OLT Huawei MA5800 (ont reset)' })
  @ApiParam({ name: 'oltId' })
  @ApiQuery({ name: 'slot',  type: Number })
  @ApiQuery({ name: 'port',  type: Number })
  @ApiQuery({ name: 'onuId', type: Number })
  async resetOnu(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @Query('slot',  ParseIntPipe)  slot:  number,
    @Query('port',  ParseIntPipe)  port:  number,
    @Query('onuId', ParseIntPipe)  onuId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.resetearOnu(oltId, user.empresaId, slot, port, onuId);
  }

  @Get(':oltId/board-topology')
  @ApiOperation({ summary: 'Topología física de la OLT (slots y tarjetas instaladas — display board 0)' })
  @ApiParam({ name: 'oltId' })
  async boardTopology(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.topologiaBoard(oltId, user.empresaId);
  }

  // ── Health dashboard — snapshots almacenados en BD ─────────────
  @Get(':oltId/health/boards')
  @ApiOperation({ summary: 'Últimos snapshots de boards almacenados (cron 5min)' })
  @ApiParam({ name: 'oltId' })
  async healthBoards(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.healthDash.latestBoards(oltId, user.empresaId);
  }

  @Get(':oltId/health/pom')
  @ApiOperation({ summary: 'Últimos snapshots POM almacenados (cron 15min)' })
  @ApiParam({ name: 'oltId' })
  async healthPom(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.healthDash.latestPom(oltId, user.empresaId);
  }

  @Get(':oltId/health/pon-ports')
  @ApiOperation({ summary: 'Últimos snapshots de puertos PON almacenados (cron 15min)' })
  @ApiParam({ name: 'oltId' })
  @ApiQuery({ name: 'slot', type: Number, required: false, description: 'Filtrar por slot GPON' })
  async healthPonPorts(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @Query('slot') slot: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const slotNum = slot !== undefined ? parseInt(slot, 10) : undefined;
    return this.healthDash.latestPonPorts(oltId, user.empresaId, slotNum);
  }

  @Get(':oltId/ont-version')
  @ApiOperation({ summary: 'Versión de firmware de una ONU Huawei (display ont version)' })
  @ApiParam({ name: 'oltId' })
  @ApiQuery({ name: 'slot',  type: Number })
  @ApiQuery({ name: 'port',  type: Number })
  @ApiQuery({ name: 'onuId', type: Number })
  async ontVersion(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @Query('slot',  ParseIntPipe)  slot:  number,
    @Query('port',  ParseIntPipe)  port:  number,
    @Query('onuId', ParseIntPipe)  onuId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.versionOnt(oltId, user.empresaId, slot, port, onuId);
  }

  // ═══════════════════════════════════════════════════════════════
  //  FIRMWARE UPGRADE (OMCI)
  // ═══════════════════════════════════════════════════════════════

  // ────────────────────────────────────────────────────────────
  // GET /olt-nativo/:oltId/onus
  // Lista ONUs aprovisionadas para selección en el wizard de firmware
  // ────────────────────────────────────────────────────────────
  @Get(':oltId/onus')
  @ApiOperation({ summary: 'Listar ONUs activas de una OLT (filtrable por slot/port)' })
  @ApiParam({ name: 'oltId' })
  @ApiQuery({ name: 'slot', required: false, type: Number })
  @ApiQuery({ name: 'port', required: false, type: Number })
  async listarOnusActivas(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @Query('slot') slot: string | undefined,
    @Query('port') port: string | undefined,
    @CurrentUser() user: JwtPayload,
  ): Promise<OnuActivaInfo[]> {
    const slotNum = slot != null ? parseInt(slot, 10) : undefined;
    const portNum = port != null ? parseInt(port, 10) : undefined;
    return this.firmware.listarOnusActivas(oltId, user.empresaId, slotNum, portNum);
  }

  // ────────────────────────────────────────────────────────────
  // POST /olt-nativo/:oltId/firmware/iniciar
  //
  // Recibe multipart/form-data:
  //   firmware  (File)    — el archivo .bin
  //   slot      (string)  — número de slot
  //   port      (string)  — número de puerto PON
  //   onuIds    (string)  — JSON array "[1,2,3]"
  //
  // Almacena en /tmp/firmware/{historialId}/, crea auditoría en BD
  // y dispara job en Python vía BackgroundTasks.
  // ────────────────────────────────────────────────────────────
  @Post(':oltId/firmware/iniciar')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor('firmware', {
    storage:    memoryStorage(),
    limits:     { fileSize: 64 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!file.originalname.toLowerCase().endsWith('.bin')) {
        return cb(new BadRequestException('Solo se permiten archivos .bin'), false);
      }
      cb(null, true);
    },
  }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Iniciar actualización de firmware OMCI',
    description:
      'Sube el .bin al disco del VPS y dispara la actualización para las ONUs ' +
      'seleccionadas.  Responde 202 con historialId para polling de progreso.',
  })
  @ApiParam({ name: 'oltId' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        firmware: { type: 'string', format: 'binary' },
        slot:     { type: 'string', example: '1' },
        port:     { type: 'string', example: '3' },
        onuIds:   { type: 'string', example: '[1,2,3]' },
      },
    },
  })
  async iniciarFirmware(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: IniciarFirmwareUpgradeDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ historialId: string; pythonJobId: string; message: string }> {
    return this.firmware.iniciarUpgrade(
      oltId,
      user.empresaId,
      user.sub,
      user.email ?? null,
      file,
      dto,
    );
  }

  // ────────────────────────────────────────────────────────────
  // GET /olt-nativo/:oltId/firmware/job/:historialId
  // Polling de progreso — consultado cada 10 s por el frontend
  // ────────────────────────────────────────────────────────────
  @Get(':oltId/firmware/job/:historialId')
  @ApiOperation({ summary: 'Consultar estado de un job de firmware upgrade' })
  @ApiParam({ name: 'oltId' })
  @ApiParam({ name: 'historialId' })
  async getFirmwareJob(
    @Param('oltId',       ParseUUIDPipe) oltId:       string,
    @Param('historialId', ParseUUIDPipe) historialId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<FirmwareJobResult> {
    return this.firmware.pollJobStatus(oltId, user.empresaId, historialId);
  }

  // ────────────────────────────────────────────────────────────
  // GET /olt-nativo/:oltId/firmware/historial
  // ────────────────────────────────────────────────────────────
  @Get(':oltId/firmware/historial')
  @ApiOperation({ summary: 'Historial de operaciones de firmware para una OLT' })
  @ApiParam({ name: 'oltId' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async historialFirmware(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @Query('limit') limit: string | undefined,
    @CurrentUser() user: JwtPayload,
  ): Promise<FirmwareJobResult[]> {
    const n = limit ? parseInt(limit, 10) : 20;
    return this.firmware.listarHistorial(oltId, user.empresaId, n);
  }

  // ═══════════════════════════════════════════════════════════════
  //  POOL DE SERVICE PORT IDs
  // ═══════════════════════════════════════════════════════════════

  @Get(':oltId/service-port-pool')
  @ApiOperation({ summary: 'Estado del pool de Service Port IDs para una OLT' })
  @ApiParam({ name: 'oltId' })
  async poolEstado(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<EstadoPool> {
    return this.pool.obtenerEstado(oltId, user.empresaId);
  }

  @Post(':oltId/service-port-pool/configurar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Configurar rango de Service Port IDs para el pool de una OLT' })
  @ApiParam({ name: 'oltId' })
  async poolConfigurar(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @Body() dto: ConfigurarPoolDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ insertados: number; omitidos: number }> {
    return this.pool.configurarRango(oltId, user.empresaId, dto);
  }

  @Delete(':oltId/service-port-pool/libres')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Eliminar entradas libres del pool (para reconfigurar rango)' })
  @ApiParam({ name: 'oltId' })
  async poolLimpiarLibres(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ eliminados: number }> {
    return this.pool.limpiarLibres(oltId, user.empresaId);
  }

  // ── FTTH Two-Phase Provisioning ───────────────────────────────

  @Post(':oltId/ftth/provision')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Aprovisionar ONU FTTH — Fase 1 (GPON) + poll + Fase 2 (WAN PPPoE)' })
  @ApiParam({ name: 'oltId' })
  async provisionarFtth(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @Body() dto: ProvisionarFtthDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<FtthProvisionResult> {
    return this.ftth.provisionarFtth(oltId, user.empresaId, dto);
  }

  @Post(':oltId/ftth/reinject-wan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Re-inyectar config WAN PPPoE en ONU FTTH ya registrada en GPON' })
  @ApiParam({ name: 'oltId' })
  async reinjectarWan(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @Body() dto: ReinjectarWanDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<FtthProvisionResult> {
    return this.ftth.reinjectarWan(oltId, user.empresaId, dto);
  }

  @Post(':oltId/ftth/desaprovisionar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Desaprovisionar ONU FTTH — rollback GPON + liberar pools + soft-delete registro' })
  @ApiParam({ name: 'oltId' })
  async desaprovisionarFtth(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @Body() dto: DesaprovisionarFtthDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ exitoso: boolean; mensaje: string; error?: string }> {
    return this.ftth.desaprovisionar(oltId, user.empresaId, dto);
  }

  // Rollback de aprovisionamiento por contrato (resuelve la OLT del registro).
  @Post('ftth/desaprovisionar-contrato/:contratoId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Desaprovisionar ONU FTTH por contrato (rollback canónico)' })
  @ApiParam({ name: 'contratoId' })
  async desaprovisionarFtthPorContrato(
    @Param('contratoId', ParseUUIDPipe) contratoId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ exitoso: boolean; mensaje: string; error?: string }> {
    return this.ftth.desaprovisionarPorContrato(contratoId, user.empresaId);
  }

  @Post('ftth/actualizar-wan/:contratoId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar la WAN PPPoE de la ONU con las credenciales actuales del contrato' })
  @ApiParam({ name: 'contratoId' })
  async actualizarWanFtth(
    @Param('contratoId', ParseUUIDPipe) contratoId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ actualizado: boolean; mensaje: string; error?: string; skipped?: boolean }> {
    return this.ftth.actualizarWan(contratoId, user.empresaId);
  }

  @Post('ftth/cancelar/:contratoId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancelar aprovisionamiento FTTH en curso — limpia todo (OLT + BD)' })
  @ApiParam({ name: 'contratoId' })
  async cancelarFtth(
    @Param('contratoId', ParseUUIDPipe) contratoId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ cancelado: boolean; mensaje: string }> {
    return this.ftth.cancelarFtth(contratoId, user.empresaId);
  }

  @Post(':oltId/ftth/cambiar-velocidad')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cambiar velocidad ONU en caliente — actualiza traffic-table del service-port' })
  @ApiParam({ name: 'oltId' })
  async cambiarVelocidadFtth(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @Body() dto: CambiarVelocidadDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ exitoso: boolean; mensaje: string; error?: string }> {
    return this.ftth.cambiarVelocidad(oltId, user.empresaId, dto);
  }

  @Post(':oltId/ftth/suspender')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspender ONU FTTH — desactiva ONT en OLT Huawei sin eliminar service-port' })
  @ApiParam({ name: 'oltId' })
  async suspenderFtth(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @Body('contratoId') contratoId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ exitoso: boolean; mensaje: string; error?: string }> {
    return this.ftth.suspender(oltId, user.empresaId, contratoId);
  }

  @Post(':oltId/ftth/rehabilitar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rehabilitar ONU FTTH — reactiva ONT previamente suspendida' })
  @ApiParam({ name: 'oltId' })
  async rehabilitarFtth(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @Body('contratoId') contratoId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ exitoso: boolean; mensaje: string; error?: string }> {
    return this.ftth.rehabilitar(oltId, user.empresaId, contratoId);
  }

  @Get(':oltId/onu-id-pool')
  @ApiOperation({ summary: 'Estado del pool de ONU IDs para un puerto PON de una OLT' })
  @ApiParam({ name: 'oltId' })
  @ApiQuery({ name: 'slot', type: Number })
  @ApiQuery({ name: 'port', type: Number })
  async onuIdPoolEstado(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @Query('slot', ParseIntPipe)   slot:  number,
    @Query('port', ParseIntPipe)   port:  number,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ total: number; libres: number; ocupados: number; inicializado: boolean }> {
    return this.onuIdPool.obtenerEstado(oltId, user.empresaId, slot, port);
  }

  @Get(':oltId/ftth/signal-dashboard')
  @ApiOperation({ summary: 'Dashboard de señal — batch-poll ONUs activas de una OLT FTTH' })
  @ApiParam({ name: 'oltId' })
  async signalDashboard(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ftth.signalDashboard(oltId, user.empresaId);
  }

  @Get(':oltId/ftth/reconciliar')
  @ApiOperation({ summary: 'Reconciliar ERP vs OLT — detecta ONUs perdidas y huérfanas' })
  @ApiParam({ name: 'oltId' })
  async reconciliarFtth(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ftth.reconciliar(oltId, user.empresaId);
  }

  @Post(':oltId/wizard/inicializar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Wizard OLT: importa perfiles + traffic tables desde la OLT al ERP' })
  @ApiParam({ name: 'oltId' })
  async wizardInicializarOlt(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{
    lineprofiles:   Array<{ profile_id: number; name: string }>;
    srvprofiles:    Array<{ profile_id: number; name: string }>;
    trafficTables:  { insertadas: number; actualizadas: number };
    total:          number;
  }> {
    const perfiles = await this.service.listarPerfilesOlt(oltId, user.empresaId);
    const trafficResult = await this.trafficTables.sincronizarDesdeOlt(
      oltId, user.empresaId, perfiles.traffic_tables,
    );
    return {
      lineprofiles:  perfiles.lineprofiles,
      srvprofiles:   perfiles.srvprofiles,
      trafficTables: trafficResult,
      total:         perfiles.lineprofiles.length + perfiles.srvprofiles.length + perfiles.traffic_tables.length,
    };
  }

  @Get('ftth/estado/:contratoId')
  @ApiOperation({ summary: 'Obtener estado de aprovisionamiento FTTH de un contrato' })
  @ApiParam({ name: 'contratoId' })
  async estadoFtth(
    @Param('contratoId', ParseUUIDPipe) contratoId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<FtthOnuRegistro | null> {
    return this.ftth.obtenerEstado(contratoId, user.empresaId);
  }

  // ────────────────────────────────────────────────────────────
  // VLANs por OLT

  @Get(':oltId/vlans')
  @ApiOperation({ summary: 'Listar VLANs configuradas en una OLT' })
  @ApiParam({ name: 'oltId' })
  async listarVlans(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<OltVlan[]> {
    return this.oltVlans.listar(oltId, user.empresaId);
  }

  @Post(':oltId/vlans')
  @ApiOperation({ summary: 'Agregar VLAN a una OLT (solo BD, para imports masivos)' })
  @ApiParam({ name: 'oltId' })
  async agregarVlan(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @Body() dto: AgregarVlanDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<OltVlan> {
    return this.oltVlans.agregar(oltId, user.empresaId, dto);
  }

  @Post(':oltId/vlans/con-cli')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Agregar VLAN con push a CLI (atómico: BD syncing → OLT → BD active)' })
  @ApiParam({ name: 'oltId' })
  async agregarVlanConCli(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @Body() dto: AgregarVlanDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<OltVlan> {
    return this.oltVlans.agregarConCli(oltId, user.empresaId, dto);
  }

  @Delete(':oltId/vlans/:vlanId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar VLAN de una OLT (solo BD)' })
  @ApiParam({ name: 'oltId' })
  @ApiParam({ name: 'vlanId', type: Number })
  async eliminarVlan(
    @Param('oltId', ParseUUIDPipe)  oltId:  string,
    @Param('vlanId', ParseIntPipe)  vlanId: number,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    return this.oltVlans.eliminar(oltId, user.empresaId, vlanId);
  }

  @Delete(':oltId/vlans/:vlanId/con-cli')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar VLAN con guard de integridad + CLI (guarded + atómico)' })
  @ApiParam({ name: 'oltId' })
  @ApiParam({ name: 'vlanId', type: Number })
  async eliminarVlanConCli(
    @Param('oltId', ParseUUIDPipe)  oltId:  string,
    @Param('vlanId', ParseIntPipe)  vlanId: number,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    return this.oltVlans.eliminarConCli(oltId, user.empresaId, vlanId);
  }

  @Patch(':oltId/vlans/:vlanId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Editar nombre de una VLAN (BD only)' })
  @ApiParam({ name: 'oltId' })
  @ApiParam({ name: 'vlanId', type: Number })
  async editarVlan(
    @Param('oltId', ParseUUIDPipe)  oltId:  string,
    @Param('vlanId', ParseIntPipe)  vlanId: number,
    @Body('nombre') nombre: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<OltVlan> {
    return this.oltVlans.editarNombre(oltId, user.empresaId, vlanId, nombre);
  }

  @Post(':oltId/vlans/pull-desde-olt')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pull de VLANs desde hardware OLT → BD (sincronización bidireccional)' })
  @ApiParam({ name: 'oltId' })
  async pullVlansDesdeOlt(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ insertadas: number; omitidas: number }> {
    return this.oltVlans.pullDesdeOlt(oltId, user.empresaId);
  }

  @Post(':oltId/vlans/sincronizar')
  @ApiOperation({ summary: 'Sincronizar VLANs desde array de configuración' })
  @ApiParam({ name: 'oltId' })
  async sincronizarVlans(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @Body() body: { vlans: Array<{ vlan_id: number; nombre: string }> },
    @CurrentUser() user: JwtPayload,
  ): Promise<{ insertadas: number; omitidas: number }> {
    return this.oltVlans.sincronizarDesdeArray(oltId, user.empresaId, body.vlans);
  }

  // ────────────────────────────────────────────────────────────
  // Traffic Tables por OLT

  @Get(':oltId/traffic-tables')
  @ApiOperation({ summary: 'Listar traffic tables configuradas en una OLT' })
  @ApiParam({ name: 'oltId' })
  async listarTrafficTables(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<OltTrafficTable[]> {
    return this.trafficTables.listar(oltId, user.empresaId);
  }

  @Post(':oltId/traffic-tables')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Crear traffic table con push a CLI Huawei (atómico: CLI → BD)' })
  @ApiParam({ name: 'oltId' })
  async agregarTrafficTable(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @Body() dto: AgregarTrafficTableDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<OltTrafficTable> {
    return this.trafficTables.agregarConCli(oltId, user.empresaId, dto);
  }

  @Patch(':oltId/traffic-tables/:trafficId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Editar traffic table con guard + CLI (guarded + atómico)' })
  @ApiParam({ name: 'oltId' })
  @ApiParam({ name: 'trafficId', type: Number })
  async editarTrafficTable(
    @Param('oltId', ParseUUIDPipe)    oltId:     string,
    @Param('trafficId', ParseIntPipe) trafficId: number,
    @Body() dto: EditarTrafficTableDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<OltTrafficTable> {
    return this.trafficTables.editarConCli(oltId, user.empresaId, trafficId, dto);
  }

  @Post(':oltId/traffic-tables/sincronizar')
  @ApiOperation({ summary: 'Sincronizar traffic tables desde OLT (usa endpoint de perfiles)' })
  @ApiParam({ name: 'oltId' })
  async sincronizarTrafficTables(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ insertadas: number; actualizadas: number }> {
    const perfiles = await this.service.listarPerfilesOlt(oltId, user.empresaId);
    const tablas = (perfiles.traffic_tables ?? []) as Array<{
      index: number; name: string; cir_kbps?: number; pir_kbps?: number;
      cbs_bytes?: number | null; pbs_bytes?: number | null;
    }>;
    return this.trafficTables.sincronizarDesdeOlt(oltId, user.empresaId, tablas);
  }

  @Delete(':oltId/traffic-tables/:trafficId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar traffic table de una OLT (solo BD)' })
  @ApiParam({ name: 'oltId' })
  @ApiParam({ name: 'trafficId', type: Number })
  async eliminarTrafficTable(
    @Param('oltId', ParseUUIDPipe)      oltId:     string,
    @Param('trafficId', ParseIntPipe)   trafficId: number,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    return this.trafficTables.eliminar(oltId, user.empresaId, trafficId);
  }

  @Delete(':oltId/traffic-tables/:trafficId/con-cli')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar traffic table con guard de integridad + CLI (guarded + atómico)' })
  @ApiParam({ name: 'oltId' })
  @ApiParam({ name: 'trafficId', type: Number })
  async eliminarTrafficTableConCli(
    @Param('oltId', ParseUUIDPipe)    oltId:     string,
    @Param('trafficId', ParseIntPipe) trafficId: number,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    return this.trafficTables.eliminarConCli(oltId, user.empresaId, trafficId);
  }

  // ═══════════════════════════════════════════════════════════════
  //  PÁGINA DE DETALLE: /configuracion/olts/[id]
  // ═══════════════════════════════════════════════════════════════

  /** PATCH parcial — formulario de edición de la página de detalle */
  @Patch(':oltId')
  @ApiOperation({ summary: 'Actualización parcial de OLT (PATCH)' })
  @ApiParam({ name: 'oltId' })
  async patchOlt(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @Body() dto: UpdateOltDispositivoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.actualizar(oltId, user.empresaId, dto);
  }

  /** Tarjetas físicas detectadas en el último sync */
  @Get(':oltId/boards')
  @ApiOperation({ summary: 'Listar tarjetas (boards) detectadas en una OLT' })
  @ApiParam({ name: 'oltId' })
  async listarBoards(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<OltBoard[]> {
    return this.sync['boardRepo'].find({
      where: { oltId, empresaId: user.empresaId },
      order: { slot: 'ASC' },
    });
  }

  /** Line profiles detectados en el último sync */
  @Get(':oltId/line-profiles')
  @ApiOperation({ summary: 'Listar line profiles detectados en una OLT' })
  @ApiParam({ name: 'oltId' })
  async listarLineProfiles(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<OltLineProfile[]> {
    return this.sync['lineProfileRepo'].find({
      where: { oltId, empresaId: user.empresaId },
      order: { profileId: 'ASC' },
    });
  }

  /** Service profiles detectados en el último sync */
  @Get(':oltId/service-profiles')
  @ApiOperation({ summary: 'Listar service profiles detectados en una OLT' })
  @ApiParam({ name: 'oltId' })
  async listarServiceProfiles(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<OltServiceProfile[]> {
    return this.sync['srvProfileRepo'].find({
      where: { oltId, empresaId: user.empresaId },
      order: { profileId: 'ASC' },
    });
  }

  /** Log de eventos (olt_operacion_log) paginado */
  @Get(':oltId/eventos')
  @ApiOperation({ summary: 'Log de operaciones de una OLT (paginado)' })
  @ApiParam({ name: 'oltId' })
  @ApiQuery({ name: 'page',  required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async listarEventos(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @Query('page')  page:  string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ data: OltOperacionLog[]; total: number }> {
    const take = Math.min(parseInt(limit ?? '20', 10), 100);
    const skip = (parseInt(page ?? '1', 10) - 1) * take;
    return this.service.listarEventos(oltId, user.empresaId, take, skip);
  }

  /** ONUs FTTH aprovisionadas en esta OLT (cross-ref ERP) */
  @Get(':oltId/ftth-registros')
  @ApiOperation({ summary: 'ONUs FTTH aprovisionadas en esta OLT (registros ERP)' })
  @ApiParam({ name: 'oltId' })
  @ApiQuery({ name: 'page',  required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async listarFtthRegistros(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @Query('page')  page:  string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ data: FtthOnuRegistro[]; total: number }> {
    const take = Math.min(parseInt(limit ?? '50', 10), 200);
    const skip = (parseInt(page ?? '1', 10) - 1) * take;
    return this.ftth.listarPorOlt(oltId, user.empresaId, take, skip);
  }

  /** Iniciar sincronización asíncrona OLT → ERP */
  @Post(':oltId/sync')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Iniciar sincronización OLT → ERP (asíncrona, responde con jobId)' })
  @ApiParam({ name: 'oltId' })
  async iniciarSync(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ jobId: string }> {
    return this.sync.iniciarSync(oltId, user.empresaId);
  }

  /** Estado del último (o activo) sync job */
  @Get(':oltId/sync/status')
  @ApiOperation({ summary: 'Estado del último job de sincronización de una OLT' })
  @ApiParam({ name: 'oltId' })
  async estadoSync(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<OltSyncJob | null> {
    return this.sync.estadoSync(oltId, user.empresaId);
  }

  /** Inventario observado de ONUs (read-model) + resumen de drift del último sync */
  @Get(':oltId/inventario')
  @ApiOperation({ summary: 'Inventario de ONUs de la OLT (snapshot del reconcile) + drift' })
  @ApiParam({ name: 'oltId' })
  async inventarioOnus(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.sync.inventario(oltId, user.empresaId);
  }

  /** Drift ERP↔OLT calculado del read-model (sin SSH): discrepancias por categoría */
  @Get(':oltId/drift')
  @ApiOperation({ summary: 'Drift ERP↔OLT: en-ERP-no-en-OLT, sin-contrato, no-aprovisionadas' })
  @ApiParam({ name: 'oltId' })
  async driftOlt(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.sync.drift(oltId, user.empresaId);
  }

  /** Re-aplicar (push ERP→OLT) una ONU en drift: encola REAPROVISIONAR_ONU vía outbox */
  @Post(':oltId/drift/reaplicar/:contratoId')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Encolar re-aprovisionamiento de una ONU (push ERP→OLT resiliente)' })
  @ApiParam({ name: 'oltId' })
  @ApiParam({ name: 'contratoId' })
  async reaplicarDrift(
    @Param('oltId', ParseUUIDPipe) _oltId: string,
    @Param('contratoId', ParseUUIDPipe) contratoId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ encolado: boolean }> {
    this.events.emit('ftth.drift.reaplicar', { contratoId, empresaId: user.empresaId });
    return { encolado: true };
  }
}
