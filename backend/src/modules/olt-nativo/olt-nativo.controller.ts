import {
  BadRequestException,
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
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
  DesaprovisionarFtthDto,
  FtthProvisionResult,
  ProvisionarFtthDto,
  ProvisionFtthService,
  ReinjectarWanDto,
} from './services/provision-ftth.service';
import {
  ConfigurarPoolDto,
  EstadoPool,
  OltServicePortPoolService,
} from './services/olt-service-port-pool.service';
import { OltOnuIdPoolService } from './services/olt-onu-id-pool.service';
import { AgregarVlanDto, OltVlanService }         from './services/olt-vlan.service';
import { OltTrafficTableService } from './services/olt-traffic-table.service';
import { OltVlan }           from './entities/olt-vlan.entity';
import { OltTrafficTable }   from './entities/olt-traffic-table.entity';
import { FtthOnuRegistro }         from './entities/ftth-onu-registro.entity';
import {
  CrearOltIntegracionDto,
  DiscoverOnusQueryDto,
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
    private readonly service:   OltNativoService,
    private readonly firmware:  FirmwareService,
    private readonly ftth:      ProvisionFtthService,
    private readonly pool:      OltServicePortPoolService,
    private readonly onuIdPool:     OltOnuIdPoolService,
    private readonly oltVlans:      OltVlanService,
    private readonly trafficTables: OltTrafficTableService,
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
    return this.service['automation'].health();
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

  @Get('ftth/estado/:contratoId')
  @ApiOperation({ summary: 'Obtener estado de aprovisionamiento FTTH de un contrato' })
  @ApiParam({ name: 'contratoId' })
  async estadoFtth(
    @Param('contratoId', ParseUUIDPipe) contratoId: string,
  ): Promise<FtthOnuRegistro | null> {
    return this.ftth.obtenerEstado(contratoId);
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
  @ApiOperation({ summary: 'Agregar VLAN a una OLT' })
  @ApiParam({ name: 'oltId' })
  async agregarVlan(
    @Param('oltId', ParseUUIDPipe) oltId: string,
    @Body() dto: AgregarVlanDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<OltVlan> {
    return this.oltVlans.agregar(oltId, user.empresaId, dto);
  }

  @Delete(':oltId/vlans/:vlanId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar VLAN de una OLT' })
  @ApiParam({ name: 'oltId' })
  @ApiParam({ name: 'vlanId', type: Number })
  async eliminarVlan(
    @Param('oltId', ParseUUIDPipe)  oltId:  string,
    @Param('vlanId', ParseIntPipe)  vlanId: number,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    return this.oltVlans.eliminar(oltId, user.empresaId, vlanId);
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
    }>;
    return this.trafficTables.sincronizarDesdeOlt(oltId, user.empresaId, tablas);
  }

  @Delete(':oltId/traffic-tables/:trafficId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar traffic table de una OLT' })
  @ApiParam({ name: 'oltId' })
  @ApiParam({ name: 'trafficId', type: Number })
  async eliminarTrafficTable(
    @Param('oltId', ParseUUIDPipe)      oltId:     string,
    @Param('trafficId', ParseIntPipe)   trafficId: number,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    return this.trafficTables.eliminar(oltId, user.empresaId, trafficId);
  }
}
