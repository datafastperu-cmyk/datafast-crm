import {
  BadRequestException,
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Param, ParseUUIDPipe, Post, Put, Query,
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
  ) {}

  // ────────────────────────────────────────────────────────────
  // Listar OLTs nativas de la empresa
  // ────────────────────────────────────────────────────────────
  @Get()
  @ApiOperation({ summary: 'Listar OLTs nativas activas de la empresa' })
  async listar(@CurrentUser() user: JwtPayload) {
    return this.service.listar(user.empresaId);
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
}
