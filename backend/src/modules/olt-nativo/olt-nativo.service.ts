import {
  BadRequestException, ConflictException, Injectable,
  Logger, NotFoundException, OnModuleInit, ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository }             from 'typeorm';
import { ModuleHealthService }                from '../../common/services/module-health.service';

import { OltDispositivo, OltMarca, OltMetodoConexion } from './entities/olt-dispositivo.entity';
import { OltProveedorConfig, TipoProveedor }    from './entities/olt-proveedor-config.entity';
import { Onu, EstadoOnu }                        from '../smartolt/entities/onu.entity';
import { SmartoltApiService, ProvisionarOnuPayload } from '../smartolt/smartolt-api.service';
import { OltAutomationClient }   from './olt-automation.client';
import { OltOperationRouter, SinProveedorConfigException } from './services/olt-operation-router.service';
import { OltProvisionPayload, OltMetricasPayload, ProveedorCredenciales } from './interfaces/olt-provider.interface';
import { SmartoltProvider }      from './providers/smartolt.provider';
import { decrypt, encrypt }      from '../../common/utils/encryption.util';
import {
  CrearOltIntegracionDto,
  DiscoverResult,
  MetricasOnuResult,
  ObtenerMetricasDto,
  OltConProveedorPrincipal,
  OltPerfilesResult,
  ProvisionarOnuNativaDto,
  ProvisionResult,
  PythonBoardTopologyRequest,
  PythonDiscoverRequest,
  PythonClassifyOnusRequest,
  PythonListProfilesRequest,
  PythonOntResetRequest,
  PythonOntVersionRequest,
  PythonProvisionRequest,
  PythonWizardTopologyResponse,
  UpsertProveedorOltDto,
  ValidarIpResult,
  WizardCommitDto,
} from './dto/olt-nativo-ops.dto';
import { CircuitBreakerService } from './services/circuit-breaker.service';
import { evaluarCompatibilidadModelo, EvaluacionCompatibilidad } from './capability/olt-model-catalog';
import { CreateOltDispositivoDto, UpdateOltDispositivoDto, Tr069ProfileDto } from './dto/olt-dispositivo.dto';

// ─────────────────────────────────────────────────────────────
// OltNativoService — Orquestador híbrido NATIVO / SMARTOLT
//
// Regla de routing (basada en metodoConexion de OltDispositivo):
//   SMARTOLT_API → delega en SmartoltApiService (flujo existente)
//   NATIVO_SSH   → descifra credenciales → llama microservicio Python
//   NATIVO_SNMP  → solo métricas (SNMP no permite aprovisionamiento CLI)
//
// Flujo VPN:  NestJS → 127.0.0.1:8001 (Python)
//             Python → tun0 (OpenVPN) → IP privada de la OLT
// ─────────────────────────────────────────────────────────────
@Injectable()
export class OltNativoService implements OnModuleInit {
  private readonly logger = new Logger(OltNativoService.name);

  private degraded      = false;
  private degradedReason: string | null = null;

  constructor(
    @InjectDataSource()
    private readonly ds: DataSource,

    @InjectRepository(OltDispositivo)
    private readonly oltRepo: Repository<OltDispositivo>,

    @InjectRepository(OltProveedorConfig)
    private readonly proveedorRepo: Repository<OltProveedorConfig>,

    @InjectRepository(Onu)
    private readonly onuRepo: Repository<Onu>,

    private readonly smartoltApi:      SmartoltApiService,
    private readonly automation:       OltAutomationClient,
    private readonly moduleHealth:     ModuleHealthService,
    private readonly router:           OltOperationRouter,
    private readonly breaker:          CircuitBreakerService,
    private readonly smartoltProvider: SmartoltProvider,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ds.query(`SELECT 1 FROM olt_dispositivos LIMIT 0`);
      this.moduleHealth.registrar('olt-nativo', 'ok');
    } catch (err: any) {
      this.degraded       = true;
      this.degradedReason = err.message;
      this.moduleHealth.registrar('olt-nativo', 'degraded', err.message);
    }
  }

  isDegraded():        boolean       { return this.degraded; }
  getDegradedReason(): string | null { return this.degradedReason; }

  private assertNotDegraded(): void {
    if (this.degraded) {
      throw new ServiceUnavailableException(
        `Módulo OLT Nativo no disponible: ${this.degradedReason ?? 'error de esquema en BD'}`,
      );
    }
  }

  // ────────────────────────────────────────────────────────────
  // provisionarOnuNativa
  //
  // Lee la OLT de BD, descifra la contraseña en memoria y
  // despacha al driver correcto según metodoConexion.
  // ────────────────────────────────────────────────────────────
  async provisionarOnuNativa(
    oltId:     string,
    empresaId: string,
    dto:       ProvisionarOnuNativaDto,
  ): Promise<ProvisionResult> {
    this.assertNotDegraded();

    // Validar que el contrato existe, pertenece a la empresa y está ACTIVO
    const [contrato] = await this.ds.query<{ estado: string; aprovisionado: boolean; numero_contrato: string }[]>(
      `SELECT estado, aprovisionado, numero_contrato
       FROM contratos
       WHERE id = $1 AND empresa_id = $2 AND deleted_at IS NULL`,
      [dto.contratoId, empresaId],
    );
    if (!contrato) {
      throw new NotFoundException(`Contrato ${dto.contratoId} no encontrado.`);
    }
    if (contrato.estado !== 'activo') {
      throw new BadRequestException(
        `El contrato debe estar ACTIVO para aprovisionar la ONU en la OLT. ` +
        `Activa primero el servicio en MikroTik (estado actual: "${contrato.estado}").`,
      );
    }
    if (contrato.aprovisionado) {
      throw new BadRequestException(
        `El contrato ${contrato.numero_contrato} ya está aprovisionado. ` +
        `Para reaprovisionar, primero ejecuta el rollback.`,
      );
    }

    const olt = await this.findOlt(oltId, empresaId);

    // ── Camino multi-proveedor (Router) ───────────────────────
    const provisionPayload: OltProvisionPayload = {
      sn:            dto.sn.toUpperCase(),
      frame:         dto.frame ?? 0,
      slot:          dto.slot,
      port:          dto.port,
      onuId:         dto.onuId,
      vlan:          dto.vlan,
      vlanGestion:   dto.vlanGestion,
      profileSpeed:  dto.profileSpeed,
      servicePortId: dto.servicePortId,
      trafficIndex:  dto.trafficIndex,
      onuType:       dto.onuType,
      onuMode:       dto.onuMode,
    };

    const routerRes = await this._tryRouter(() =>
      this.router.provisionar(empresaId, oltId, provisionPayload, null),
    );

    if (routerRes !== null) {
      return {
        success:        routerRes.exitoso,
        message:        routerRes.mensaje,
        oltIp:          routerRes.datos?.oltIp ?? olt.ipGestion,
        onuSn:          routerRes.datos?.onuSn ?? dto.sn,
        metodoConexion: olt.metodoConexion,
        details:        (routerRes.datos?.details as any) ?? null,
      };
    }

    // ── Legacy (sin olt_proveedor_config aún) ─────────────────
    if (olt.metodoConexion === OltMetodoConexion.SMARTOLT_API) {
      return this.provisionarViaSmartolt(olt, dto);
    }

    if (olt.metodoConexion === OltMetodoConexion.NATIVO_SNMP) {
      throw new ServiceUnavailableException(
        'Las OLTs con método NATIVO_SNMP no soportan aprovisionamiento CLI. ' +
        'Cambia el método a NATIVO_SSH o SMARTOLT_API.',
      );
    }

    return this.provisionarViaPython(olt, dto);
  }

  // ────────────────────────────────────────────────────────────
  // obtenerMetricasOnuNativa
  //
  // Consulta métricas ópticas en tiempo real vía SSH al
  // microservicio Python.  NUNCA propaga excepciones de red al
  // frontend — ante cualquier fallo devuelve:
  //   { status: 'offline', metricsAvailable: false }
  // ────────────────────────────────────────────────────────────
  async obtenerMetricasOnuNativa(
    oltId:     string,
    empresaId: string,
    dto:       ObtenerMetricasDto,
  ): Promise<MetricasOnuResult> {

    const olt = await this.findOlt(oltId, empresaId);

    // ── Camino multi-proveedor (Router) ───────────────────────
    const metricasPayload: OltMetricasPayload = {
      slot:  dto.slot,
      port:  dto.port,
      onuId: dto.onuId,
      sn:    dto.sn,
    };

    const routerRes = await this._tryRouter(() =>
      this.router.obtenerMetricas(empresaId, oltId, metricasPayload),
    );

    if (routerRes !== null) {
      const d = routerRes.datos;
      if (d?.metricsAvailable && dto.sn) {
        await this.persistirMetricasOnu(
          dto.sn, d.rxPowerDbm ?? null, d.txPowerDbm ?? null, d.temperatureC ?? null,
        );
      }
      const status =
        d?.alarm?.level === 'critical' ? 'offline' :
        d?.alarm?.level === 'warning'  ? 'degraded' :
        (d?.status ?? 'offline');
      return {
        status,
        metricsAvailable: d?.metricsAvailable ?? false,
        rxPowerDbm:       d?.rxPowerDbm,
        txPowerDbm:       d?.txPowerDbm,
        temperatureC:     d?.temperatureC,
        alarm:            d?.alarm,
      };
    }

    // ── Legacy ─────────────────────────────────────────────────
    if (olt.metodoConexion === OltMetodoConexion.SMARTOLT_API) {
      return this.metricasViaSmartolt(olt, dto);
    }

    return this.metricasViaPython(olt, dto);
  }

  // ────────────────────────────────────────────────────────────
  // buscarOnusNoAutorizadas
  //
  // Descifra credenciales de la OLT y consulta al microservicio Python
  // la lista de ONUs sin configurar / no autorizadas.
  // Nunca propaga excepciones al frontend — retorna lista vacía en error.
  // Solo disponible para OLTs con método NATIVO_SSH.
  // ────────────────────────────────────────────────────────────
  async buscarOnusNoAutorizadas(
    oltId:     string,
    empresaId: string,
    slot?:     number,
    port?:     number,
  ): Promise<DiscoverResult> {

    const olt = await this.findOlt(oltId, empresaId);

    // Camino multi-proveedor (Router)
    const routerRes = await this._tryRouter(() =>
      this.router.descubrirOnus(empresaId, oltId, slot, port),
    );
    if (routerRes !== null) {
      const onus = routerRes.datos ?? [];
      return { success: routerRes.exitoso, total: onus.length, onus };
    }

    // Legacy: solo NATIVO_SSH
    if (olt.metodoConexion !== OltMetodoConexion.NATIVO_SSH) {
      this.logger.warn(
        `buscarOnusNoAutorizadas: OLT "${olt.nombre}" usa ${olt.metodoConexion} — ` +
        'solo NATIVO_SSH soporta descubrimiento.',
      );
      return { success: false, total: 0, onus: [] };
    }

    const password = this.decryptPassword(olt.contrasenaCifrada, olt.ipGestion);

    const payload: PythonDiscoverRequest = {
      connection: {
        ip:       olt.ipGestion,
        port:     olt.puerto,
        username: olt.usuarioAnclado,
        password,
        brand:    olt.marca,
      },
      slot: slot ?? null,
      port: port ?? null,
    };

    this.logger.log(
      `Buscando ONUs pendientes | OLT=${olt.nombre} (${olt.ipGestion}) ` +
      `slot=${slot ?? '*'} port=${port ?? '*'}`,
    );

    try {
      const res = await this.automation.discoverOnus(payload);
      return { success: res.success, total: res.total, onus: res.onus };
    } catch (error) {
      this.logger.warn(
        `Error en descubrimiento de ONUs | OLT=${olt.nombre}: ${error.message}`,
      );
      return { success: false, total: 0, onus: [] };
    }
  }

  // ────────────────────────────────────────────────────────────
  // clasificarOnus — estado de todas las ONUs de un puerto PON,
  // cruzado con contratos/clientes de la BD.
  //
  // estado_operativo (de la OLT): online | apagada | ruptura_fibra |
  //   desactivada | offline | no_aprovisionada (autofind).
  // sinContrato: la ONU existe en la OLT pero su SN no cruza con ningún
  //   registro FTTH vigente (típico de ONUs creadas por SmartOLT/AdminOLT).
  // ────────────────────────────────────────────────────────────
  async clasificarOnus(
    oltId:     string,
    empresaId: string,
    slot:      number,
    port:      number,
  ): Promise<{
    success: boolean;
    slot:    number;
    port:    number;
    onus:    Array<Record<string, unknown>>;
    error?:  string;
  }> {
    const olt = await this.oltRepo.findOne({ where: { id: oltId, empresaId } });
    if (!olt) throw new NotFoundException('OLT no encontrada');

    if (olt.metodoConexion !== OltMetodoConexion.NATIVO_SSH) {
      return { success: false, slot, port, onus: [], error: `OLT usa ${olt.metodoConexion}; solo NATIVO_SSH soporta clasificación.` };
    }

    const password = this.decryptPassword(olt.contrasenaCifrada, olt.ipGestion);
    const payload: PythonClassifyOnusRequest = {
      connection: { ip: olt.ipGestion, port: olt.puerto, username: olt.usuarioAnclado, password, brand: olt.marca },
      slot,
      port,
    };

    let res: Awaited<ReturnType<OltAutomationClient['clasificarOnus']>>;
    try {
      res = await this.automation.clasificarOnus(payload);
    } catch (error) {
      this.logger.warn(`clasificarOnus | OLT=${olt.nombre}: ${(error as Error).message}`);
      return { success: false, slot, port, onus: [], error: (error as Error).message };
    }
    if (!res.success) return { success: false, slot, port, onus: [], error: res.error };

    // Mapa SN→contrato. Se indexa por los últimos 8 hex (parte única del SN),
    // porque la OLT reporta el SN crudo (48575443994E1BA5) y la BD lo guarda en
    // forma de vendedor (HWTC994E1BA5) — ambos comparten el sufijo 994E1BA5.
    const norm = (sn?: string | null): string =>
      (sn ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(-8);

    const rows: Array<{ sn: string; contrato_id: string; numero_contrato: string; cliente: string; registro_estado: string }> =
      await this.ds.query(
        `SELECT r.sn, r.contrato_id, c.numero_contrato,
                COALESCE(cl.nombre_completo, TRIM(CONCAT(cl.nombres,' ',cl.apellido_paterno,' ',cl.apellido_materno))) AS cliente,
                r.estado AS registro_estado
           FROM ftth_onu_registro r
           JOIN contratos c ON c.id = r.contrato_id
           LEFT JOIN clientes cl ON cl.id = c.cliente_id
          WHERE r.deleted_at IS NULL AND r.olt_id = $1`,
        [oltId],
      );
    const contratoPorSn = new Map<string, (typeof rows)[number]>();
    for (const row of rows) contratoPorSn.set(norm(row.sn), row);

    const onus = res.onus.map((o) => {
      const match = contratoPorSn.get(norm(o.sn));
      return {
        onuId:           o.onu_id,
        sn:              o.sn,
        estadoOperativo: o.estado_operativo,
        controlFlag:     o.control_flag,
        runState:        o.run_state,
        configState:     o.config_state,
        downCause:       o.down_cause,
        dyingGaspTime:   o.dying_gasp_time,
        rxPowerDbm:      o.rx_power_dbm,
        txPowerDbm:      o.tx_power_dbm,
        sinContrato:     !match,
        contratoId:      match?.contrato_id ?? null,
        numeroContrato:  match?.numero_contrato ?? null,
        cliente:         match?.cliente ?? null,
      };
    });

    // ONUs físicas sin aprovisionar (autofind): nunca tienen contrato.
    for (const a of res.autofind) {
      onus.push({
        onuId:           null,
        sn:              a.sn,
        estadoOperativo: 'no_aprovisionada',
        controlFlag:     null,
        runState:        null,
        configState:     null,
        downCause:       null,
        dyingGaspTime:   null,
        rxPowerDbm:      null,
        txPowerDbm:      null,
        sinContrato:     true,
        contratoId:      null,
        numeroContrato:  null,
        cliente:         a.model ?? null,
      });
    }

    return { success: true, slot, port, onus };
  }

  // ─── CRUD básico ─────────────────────────────────────────────

  // ────────────────────────────────────────────────────────────
  // testConexion / testConexionDirecta
  //
  // Prueba la conectividad SSH a la OLT usando el endpoint
  // discover-onus del microservicio Python como proxy.
  // Nunca propaga excepciones — siempre devuelve { exitoso, mensaje }.
  // ────────────────────────────────────────────────────────────
  async testConexion(
    oltId:     string,
    empresaId: string,
  ): Promise<{ exitoso: boolean; mensaje: string; latenciaMs?: number }> {
    const olt = await this.findOlt(oltId, empresaId);

    // Camino multi-proveedor (Router)
    const routerRes = await this._tryRouter(() => this.router.testConexion(empresaId, oltId));
    if (routerRes !== null) {
      return { exitoso: routerRes.exitoso, mensaje: routerRes.mensaje, latenciaMs: routerRes.latenciaMs };
    }

    // Legacy: SSH directo sin configs
    const pwd = this.decryptPassword(olt.contrasenaCifrada, olt.ipGestion);
    return this._probarSsh({ ip: olt.ipGestion, puerto: olt.puerto ?? 22, usuario: olt.usuarioAnclado, password: pwd, marca: olt.marca });
  }

  async testConexionDirecta(
    empresaId: string,
    params: { ip: string; puerto: number; usuario: string; password: string; marca: string; oltId?: string },
  ): Promise<{ exitoso: boolean; mensaje: string; latenciaMs?: number }> {
    let pwd = params.password;
    if (!pwd && params.oltId) {
      const olt = await this.findOlt(params.oltId, empresaId);
      pwd = this.decryptPassword(olt.contrasenaCifrada, olt.ipGestion);
    }
    return this._probarSsh({ ...params, password: pwd });
  }

  private async _probarSsh(
    params: { ip: string; puerto: number; usuario: string; password: string; marca: string },
  ): Promise<{ exitoso: boolean; mensaje: string; latenciaMs?: number }> {
    try {
      const ip = params.ip.includes('/') ? params.ip.split('/')[0] : params.ip;
      const res = await this.automation.testConexionSsh({
        connection: { ip, port: params.puerto, username: params.usuario, password: params.password, brand: params.marca.toLowerCase() },
      });
      if (res.success) {
        return { exitoso: true, mensaje: 'Conexión SSH exitosa', latenciaMs: res.latency_ms ?? undefined };
      }
      return { exitoso: false, mensaje: res.error ?? 'Error al conectar con la OLT', latenciaMs: res.latency_ms ?? undefined };
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || 'Error desconocido';
      return { exitoso: false, mensaje: msg };
    }
  }

  async listar(empresaId: string): Promise<OltDispositivo[]> {
    return this.oltRepo.find({
      where: [
        { empresaId, activo: true, metodoConexion: OltMetodoConexion.NATIVO_SSH },
        { empresaId, activo: true, metodoConexion: OltMetodoConexion.NATIVO_SNMP },
      ],
      order: { nombre: 'ASC' },
    });
  }

  async findOne(id: string, empresaId: string): Promise<OltDispositivo> {
    return this.findOlt(id, empresaId);
  }

  async crear(empresaId: string, dto: CreateOltDispositivoDto): Promise<OltDispositivo> {
    await this._validarIpUnica(dto.ipGestion, empresaId);
    const { contrasena, ...rest } = dto;
    const contrasenaCifrada = encrypt(contrasena);
    const olt = this.oltRepo.create({ ...rest, empresaId, contrasenaCifrada });
    return this.oltRepo.save(olt);
  }

  async actualizar(id: string, empresaId: string, dto: UpdateOltDispositivoDto): Promise<OltDispositivo> {
    const olt = await this.findOlt(id, empresaId);
    if (dto.ipGestion && dto.ipGestion !== olt.ipGestion) {
      await this._validarIpUnica(dto.ipGestion, empresaId, id);
    }
    const { contrasena, ...rest } = dto;
    if (contrasena) {
      olt.contrasenaCifrada = encrypt(contrasena);
    }
    const defined = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    Object.assign(olt, defined);
    const saved = await this.oltRepo.save(olt);

    // Propagar credenciales al proveedor nativo_ssh: la config es la fuente de
    // verdad de conexión (OltConnService la prefiere). Sin esto, editar la
    // contraseña/IP aquí dejaba a los caminos Router/sync usando la vieja.
    const config = await this.proveedorRepo.findOne({
      where: { oltId: id, empresaId, tipo: 'nativo_ssh' as TipoProveedor },
    });
    if (config) {
      const c = config.credenciales as Record<string, unknown>;
      if (dto.ipGestion)      c.ip = dto.ipGestion.includes('/') ? dto.ipGestion.split('/')[0] : dto.ipGestion;
      if (dto.puerto)         c.port = dto.puerto;
      if (dto.usuarioAnclado) c.username = dto.usuarioAnclado;
      if (contrasena)         c.password_cifrado = olt.contrasenaCifrada;
      config.credenciales = c;
      await this.proveedorRepo.save(config);
    }

    return saved;
  }

  // ── Perfil TR-069 por OLT (equivalente al "TR069 Profile" de SmartOLT) ──
  async getTr069Profile(id: string, empresaId: string): Promise<{
    enabled: boolean; acsUrl: string | null; mgmtVlan: number | null;
    mgmtGateway: string | null; mgmtMask: string;
    acsUsername: string | null; hasPassword: boolean;
  }> {
    const olt = await this.findOlt(id, empresaId);
    return {
      enabled:     olt.tr069Enabled,
      acsUrl:      olt.tr069AcsUrl,
      mgmtVlan:    olt.tr069MgmtVlan,
      mgmtGateway: olt.tr069MgmtGateway,
      mgmtMask:    olt.tr069MgmtMask,
      acsUsername: olt.tr069AcsUsername,
      hasPassword: !!olt.tr069AcsPassword,   // nunca devolvemos la clave en claro
    };
  }

  async setTr069Profile(id: string, empresaId: string, dto: Tr069ProfileDto): Promise<OltDispositivo> {
    const olt = await this.findOlt(id, empresaId);
    if (dto.enabled     !== undefined) olt.tr069Enabled     = dto.enabled;
    if (dto.acsUrl      !== undefined) olt.tr069AcsUrl      = dto.acsUrl || null;
    if (dto.mgmtVlan    !== undefined) olt.tr069MgmtVlan    = dto.mgmtVlan ?? null;
    if (dto.mgmtGateway !== undefined) olt.tr069MgmtGateway = dto.mgmtGateway || null;
    if (dto.mgmtMask    !== undefined) olt.tr069MgmtMask    = dto.mgmtMask || '255.255.255.0';
    if (dto.acsUsername !== undefined) olt.tr069AcsUsername = dto.acsUsername || null;
    if (dto.acsPassword !== undefined) olt.tr069AcsPassword = dto.acsPassword ? encrypt(dto.acsPassword) : null;
    return this.oltRepo.save(olt);
  }

  async eliminar(id: string, empresaId: string): Promise<void> {
    const olt = await this.findOlt(id, empresaId);
    olt.activo = false;
    await this.oltRepo.save(olt);
  }

  // ─── Gestión de proveedores multi-proveedor ───────────────────

  async listarProveedores(oltId: string, empresaId: string): Promise<OltProveedorConfig[]> {
    this.assertNotDegraded();
    await this.findOlt(oltId, empresaId);
    return this.proveedorRepo.find({
      where: { oltId, empresaId },
      order: { prioridad: 'ASC' },
    });
  }

  async listarPorTipo(
    tipo:      TipoProveedor,
    empresaId: string,
  ): Promise<Array<{
    id:               string;
    oltId:            string;
    oltNombre:        string;
    oltMarca:         string;
    tipo:             TipoProveedor;
    prioridad:        number;
    activo:           boolean;
    circuitEstado:    string;
    healthEstado:     string;
    healthLatenciaMs: number | null;
    ultimoHealth:     string | null;
    tieneCredenciales: boolean;
  }>> {
    this.assertNotDegraded();
    const rows = await this.ds.query<Array<{
      id:                string;
      olt_id:            string;
      olt_nombre:        string;
      olt_marca:         string;
      tipo:              string;
      prioridad:         number;
      activo:            boolean;
      circuit_estado:    string;
      health_estado:     string;
      health_latencia_ms: number | null;
      ultimo_health:     string | null;
      tiene_credenciales: boolean;
      base_url:          string | null;
      olt_id_externo:    string | null;
    }>>(`
      SELECT
        c.id,
        c.olt_id,
        o.nombre              AS olt_nombre,
        o.marca               AS olt_marca,
        c.tipo,
        c.prioridad,
        c.activo,
        c.circuit_estado,
        c.health_estado,
        c.health_latencia_ms,
        c.ultimo_health,
        (c.credenciales ? 'api_key_cifrado' AND c.credenciales ? 'base_url') AS tiene_credenciales,
        (c.credenciales ->> 'base_url')       AS base_url,
        (c.credenciales ->> 'olt_id_externo') AS olt_id_externo
      FROM olt_proveedor_config c
      JOIN olt_dispositivos     o ON o.id = c.olt_id
      WHERE c.empresa_id = $1
        AND c.tipo       = $2
        AND o.deleted_at IS NULL
      ORDER BY o.nombre, c.prioridad
    `, [empresaId, tipo]);

    return rows.map((r) => ({
      id:               r.id,
      oltId:            r.olt_id,
      oltNombre:        r.olt_nombre,
      oltMarca:         r.olt_marca,
      tipo:             r.tipo as TipoProveedor,
      prioridad:        r.prioridad,
      activo:           r.activo,
      circuitEstado:    r.circuit_estado,
      healthEstado:     r.health_estado,
      healthLatenciaMs: r.health_latencia_ms,
      ultimoHealth:     r.ultimo_health ?? null,
      tieneCredenciales: r.tiene_credenciales,
      baseUrl:          r.base_url ?? null,
      oltIdExterno:     r.olt_id_externo ?? null,
    }));
  }

  async testProveedorConexion(
    configId:  string,
    empresaId: string,
  ): Promise<{ exitoso: boolean; mensaje: string; latenciaMs: number }> {
    this.assertNotDegraded();
    const result = await this.router.testConexionPorConfig(empresaId, configId);
    return {
      exitoso:    result.exitoso,
      mensaje:    result.mensaje,
      latenciaMs: result.latenciaMs ?? 0,
    };
  }

  // ─── Verificar estado ONU post-aprovisionamiento ─────────────
  // Solo disponible para OLTs con proveedor nativo_ssh activo.
  // No bloquea el flujo de provision — se llama de forma separada.
  async verificarOnu(
    oltId:     string,
    empresaId: string,
    slot:      number,
    port:      number,
    onuId:     number,
  ): Promise<{
    exitoso:    boolean;
    runState:   string | null;
    rxPowerDbm: number | null;
    txPowerDbm: number | null;
    error:      string | null;
  }> {
    this.assertNotDegraded();

    const olt = await this.findOlt(oltId, empresaId);
    const config = await this.proveedorRepo.findOne({
      where: { oltId, empresaId, tipo: 'nativo_ssh' as TipoProveedor, activo: true },
    });
    if (!config) {
      throw new BadRequestException('Esta OLT no tiene proveedor nativo_ssh activo configurado');
    }

    const c = config.credenciales as Record<string, unknown>;
    let password = '';
    if (c.password_cifrado) {
      try   { password = decrypt(c.password_cifrado as string); }
      catch { throw new BadRequestException('No se pudo descifrar la contraseña SSH'); }
    }

    try {
      const res = await this.automation.verifyOnu({
        connection: {
          ip:       (c.ip       as string) || olt.ipGestion,
          port:     ((c.port     as number) || olt.puerto) ?? 22,
          username: (c.username as string) || olt.usuarioAnclado,
          password,
          brand:    ((c.brand   as string) || olt.marca).toLowerCase(),
        },
        slot,
        port,
        onu_id: onuId,
      });
      return {
        exitoso:    res.success,
        runState:   res.run_state    ?? null,
        rxPowerDbm: res.rx_power_dbm ?? null,
        txPowerDbm: res.tx_power_dbm ?? null,
        error:      res.error        ?? null,
      };
    } catch (e: any) {
      return {
        exitoso:    false,
        runState:   null,
        rxPowerDbm: null,
        txPowerDbm: null,
        error:      e?.response?.data?.message ?? e?.message ?? 'Error al verificar ONU',
      };
    }
  }

  // ─── Lookup SmartOLT ─────────────────────────────────────────
  // Carga credenciales de una config específica y llama el endpoint de lookup.
  async listarLookupSmartolt(
    tipo:      'perfiles' | 'vlans' | 'zonas' | 'odbs' | 'tipos-onu',
    configId:  string,
    empresaId: string,
  ): Promise<unknown[]> {
    this.assertNotDegraded();

    const config = await this.proveedorRepo.findOne({ where: { id: configId, empresaId } });
    if (!config) {
      throw new NotFoundException(`Configuración ${configId} no encontrada`);
    }
    if (config.tipo !== 'smartolt') {
      throw new BadRequestException('Esta configuración no es de tipo smartolt');
    }

    const c = config.credenciales as Record<string, any>;
    let apiKey: string | undefined;
    if (c.api_key_cifrado) {
      try   { apiKey = decrypt(c.api_key_cifrado); }
      catch { throw new BadRequestException('No se pudo descifrar la API key SmartOLT'); }
    }

    const creds: ProveedorCredenciales = {
      baseUrl:      c.base_url,
      apiKey,
      oltIdExterno: c.olt_id_externo,
    };

    switch (tipo) {
      case 'perfiles':   return this.smartoltProvider.listarPerfiles(creds);
      case 'vlans':      return this.smartoltProvider.listarVlans(creds);
      case 'zonas':      return this.smartoltProvider.listarZonas(creds);
      case 'odbs':       return this.smartoltProvider.listarOdbs(creds);
      case 'tipos-onu':  return this.smartoltProvider.listarTiposOnu(creds);
    }
  }

  async upsertProveedor(
    oltId:     string,
    empresaId: string,
    dto:       UpsertProveedorOltDto,
  ): Promise<OltProveedorConfig> {
    this.assertNotDegraded();
    await this.findOlt(oltId, empresaId);

    const tipo = dto.tipo as TipoProveedor;
    const existing = await this.proveedorRepo.findOne({
      where: { oltId, empresaId, tipo },
    });

    // Construir JSONB de credenciales según tipo
    let credenciales: Record<string, unknown> = existing?.credenciales ?? {};

    if (tipo === 'nativo_ssh' || tipo === 'nativo_snmp') {
      if (dto.ip)       credenciales.ip       = dto.ip;
      if (dto.port)     credenciales.port     = dto.port;
      if (dto.username) credenciales.username = dto.username;
      if (dto.brand)    credenciales.brand    = dto.brand;
      if (dto.password) {
        credenciales.password_cifrado = encrypt(dto.password);
      }
    } else {
      // smartolt | adminolt
      if (dto.baseUrl)      credenciales.base_url      = dto.baseUrl;
      if (dto.oltIdExterno) credenciales.olt_id_externo = dto.oltIdExterno;
      if (dto.apiKey) {
        credenciales.api_key_cifrado = encrypt(dto.apiKey);
      }
    }

    if (existing) {
      existing.credenciales = credenciales;
      if (dto.prioridad !== undefined) existing.prioridad = dto.prioridad;
      if (dto.activo    !== undefined) existing.activo    = dto.activo;
      return this.proveedorRepo.save(existing);
    }

    // Regla: una OLT admite UN SOLO proveedor, fijado al registrarla. No se puede
    // agregar un segundo proveedor de otro tipo (evita fuentes de verdad en conflicto
    // sobre el mismo OLT físico). Solo se permite editar las credenciales del existente.
    const otro = await this.proveedorRepo.findOne({
      where: { oltId, empresaId, activo: true },
    });
    if (otro) {
      throw new ConflictException(
        `La OLT ya tiene un proveedor (${otro.tipo}). Cada OLT admite un solo proveedor, ` +
        `fijado al registrarla. Edita sus credenciales, o elimina y vuelve a crear la OLT ` +
        `para cambiar de proveedor.`,
      );
    }

    const nuevo = this.proveedorRepo.create({
      oltId,
      empresaId,
      tipo,
      prioridad:    dto.prioridad ?? 1,
      activo:       dto.activo    ?? true,
      credenciales,
    });
    return this.proveedorRepo.save(nuevo);
  }

  async resetCircuit(configId: string, empresaId: string): Promise<void> {
    this.assertNotDegraded();
    const config = await this.proveedorRepo.findOne({ where: { id: configId, empresaId } });
    if (!config) {
      throw new NotFoundException(`Configuración de proveedor ${configId} no encontrada`);
    }
    await this.breaker.resetForzado(configId);
  }

  async resumenProveedores(empresaId: string): Promise<Array<{
    oltId:          string;
    worstHealth:    string;
    hasOpenCircuit: boolean;
    totalActivo:    number;
  }>> {
    this.assertNotDegraded();
    const rows = await this.ds.query<Array<{
      olt_id:           string;
      worst_health:     string;
      has_open_circuit: boolean;
      total_activo:     string;
    }>>(`
      SELECT
        olt_id,
        CASE
          WHEN bool_or(health_estado = 'down')     THEN 'down'
          WHEN bool_or(health_estado = 'degraded') THEN 'degraded'
          WHEN bool_or(health_estado = 'unknown')  THEN 'unknown'
          ELSE 'ok'
        END AS worst_health,
        bool_or(circuit_estado = 'open') AS has_open_circuit,
        COUNT(*)::int AS total_activo
      FROM olt_proveedor_config
      WHERE empresa_id = $1 AND activo = TRUE
      GROUP BY olt_id
    `, [empresaId]);

    return rows.map((r) => ({
      oltId:          r.olt_id,
      worstHealth:    r.worst_health,
      hasOpenCircuit: r.has_open_circuit,
      totalActivo:    Number(r.total_activo),
    }));
  }

  // ────────────────────────────────────────────────────────────
  // PRIVADOS — flujos por driver
  // ────────────────────────────────────────────────────────────

  private async provisionarViaPython(
    olt: OltDispositivo,
    dto: ProvisionarOnuNativaDto,
  ): Promise<ProvisionResult> {

    const password = this.decryptPassword(olt.contrasenaCifrada, olt.ipGestion);

    const payload: PythonProvisionRequest = {
      connection: {
        ip:       olt.ipGestion,
        port:     olt.puerto,
        username: olt.usuarioAnclado,
        password,            // en texto plano — solo vive en memoria durante la request
        brand:    olt.marca, // OltMarca enum value ('huawei' | 'zte' | ...)
      },
      onu: {
        frame:           dto.frame,
        slot:            dto.slot,
        port:            dto.port,
        onu_id:          dto.onuId,
        sn:              dto.sn.toUpperCase(),
        vlan:            dto.vlan,
        vlan_gestion:    dto.vlanGestion,
        profile_speed:   dto.profileSpeed,
        service_port_id: dto.servicePortId,
        traffic_index:   dto.trafficIndex,
        onu_type:        dto.onuType,
        lineprofile_id:  dto.lineprofileId,
        srvprofile_id:   dto.srvprofileId,
        description:     dto.description,
        onu_mode:        dto.onuMode,
      },
    };

    this.logger.log(
      `Aprovisionando ONU vía SSH nativo | OLT=${olt.nombre} (${olt.ipGestion}) ` +
      `SN=${dto.sn} slot=${dto.slot} port=${dto.port} onu_id=${dto.onuId}`,
    );

    const res = await this.automation.provision(payload);

    return {
      success:        res.success,
      message:        res.message,
      oltIp:          res.olt_ip,
      onuSn:          res.onu_sn,
      metodoConexion: OltMetodoConexion.NATIVO_SSH,
      details:        res.details,
    };
  }

  private async provisionarViaSmartolt(
    olt: OltDispositivo,
    dto: ProvisionarOnuNativaDto,
  ): Promise<ProvisionResult> {

    if (!olt.modelo) {
      throw new ServiceUnavailableException(
        `La OLT "${olt.nombre}" está configurada como SMARTOLT_API pero no tiene ` +
        `smartolt_id. Configura el modelo en la OLT.`,
      );
    }

    const ponPort = `${dto.slot}/${dto.port}`;
    const smartoltPayload: ProvisionarOnuPayload = {
      serial:      dto.sn.toUpperCase(),
      olt_id:      olt.modelo,    // campo 'modelo' se reutiliza como smartolt_id en este flujo
      pon_port:    ponPort,
      profile:     dto.profileSpeed,
      vlan:        dto.vlan,
      description: `Cliente ${dto.clienteId}`,
    };

    this.logger.log(
      `Desviando aprovisionamiento a SmartOLT API | OLT=${olt.nombre} SN=${dto.sn}`,
    );

    const onuSmartolt = await this.smartoltApi.aprovisionarOnu(smartoltPayload);

    return {
      success:        true,
      message:        `ONU aprovisionada vía SmartOLT API: ID=${onuSmartolt.id}`,
      oltIp:          olt.ipGestion,
      onuSn:          dto.sn,
      metodoConexion: OltMetodoConexion.SMARTOLT_API,
      details:        { smartoltOnuId: onuSmartolt.id },
    };
  }

  private async metricasViaPython(
    olt: OltDispositivo,
    dto: ObtenerMetricasDto,
  ): Promise<MetricasOnuResult> {

    const password = this.decryptPassword(olt.contrasenaCifrada, olt.ipGestion);

    const payload: PythonProvisionRequest = {
      connection: {
        ip:       olt.ipGestion,
        port:     olt.puerto,
        username: olt.usuarioAnclado,
        password,
        brand:    olt.marca,
      },
      onu: {
        frame:         0,      // frame siempre 0 en consultas de señal
        slot:          dto.slot,
        port:          dto.port,
        onu_id:        dto.onuId,
        sn:            (dto.sn ?? '').toUpperCase(),
        vlan:          0,      // no requerido para métricas
        vlan_gestion:  0,
        profile_speed: '',
      },
    };

    // ── Llamada resistente al fallo ───────────────────────────
    // Cualquier excepción de red/timeout se intercepta aquí.
    // El frontend siempre recibe una respuesta estructurada.
    let pythonRes;
    try {
      pythonRes = await this.automation.getMetrics(payload);
    } catch (error) {
      this.logger.warn(
        `Microservicio OLT no disponible para métricas | ` +
        `OLT=${olt.nombre} (${olt.ipGestion}): ${error.message}`,
      );
      return { status: 'offline', metricsAvailable: false };
    }

    // ── Python respondió, pero reportó error en la OLT ───────
    if (!pythonRes.success) {
      const alarmLevel = pythonRes.alarm?.level;
      return {
        status:           alarmLevel === 'critical' ? 'offline' : 'degraded',
        metricsAvailable: false,
        alarm:            pythonRes.alarm,
      };
    }

    // ── Métricas disponibles — persistir en BD ────────────────
    if (dto.sn) {
      await this.persistirMetricasOnu(
        dto.sn,
        pythonRes.rx_power_dbm,
        pythonRes.tx_power_dbm,
        pythonRes.temperature_c,
      );
    }

    // Determinar estado según alarma
    const status =
      pythonRes.alarm?.level === 'critical' ? 'offline'
      : pythonRes.alarm?.level === 'warning'  ? 'degraded'
      : 'online';

    return {
      status,
      metricsAvailable: true,
      rxPowerDbm:       pythonRes.rx_power_dbm,
      txPowerDbm:       pythonRes.tx_power_dbm,
      temperatureC:     pythonRes.temperature_c,
      alarm:            pythonRes.alarm,
    };
  }

  private async metricasViaSmartolt(
    olt: OltDispositivo,
    dto: ObtenerMetricasDto,
  ): Promise<MetricasOnuResult> {

    if (!olt.modelo) {
      return { status: 'offline', metricsAvailable: false };
    }

    try {
      // SmartOLT no indexa por slot/port/onuId — necesita onuId interno.
      // Si el SN está disponible, buscamos el ID interno y consultamos señal.
      if (!dto.sn) {
        return { status: 'offline', metricsAvailable: false };
      }

      const onuSmartolt = await this.smartoltApi.getOnuBySerial(dto.sn);
      if (!onuSmartolt) {
        return { status: 'offline', metricsAvailable: false };
      }

      const signal = await this.smartoltApi.getSeñalOnu(olt.modelo, onuSmartolt.id);

      await this.persistirMetricasOnu(
        dto.sn, signal.rxPower, signal.txPower, signal.temperature,
      );

      return {
        status:           'online',
        metricsAvailable: true,
        rxPowerDbm:       signal.rxPower,
        txPowerDbm:       signal.txPower,
        temperatureC:     signal.temperature,
      };
    } catch (error) {
      this.logger.warn(
        `SmartOLT métricas fallidas | OLT=${olt.nombre}: ${error.message}`,
      );
      return { status: 'offline', metricsAvailable: false };
    }
  }

  // ─── Operaciones MA5800: perfiles, reset, topología, versión ──────────────

  async listarPerfilesOlt(
    oltId:     string,
    empresaId: string,
  ): Promise<OltPerfilesResult> {
    this.assertNotDegraded();
    const olt  = await this.findOlt(oltId, empresaId);
    const conn = await this._buildNativeConn(oltId, empresaId, olt);

    const payload: PythonListProfilesRequest = { connection: conn };
    const res = await this.automation.listProfiles(payload);
    if (!res.success) {
      throw new ServiceUnavailableException(res.error ?? 'No se pudieron obtener los perfiles de la OLT');
    }
    return {
      lineprofiles:   res.lineprofiles   ?? [],
      srvprofiles:    res.srvprofiles    ?? [],
      traffic_tables: res.traffic_tables ?? [],
    };
  }

  async resetearOnu(
    oltId:     string,
    empresaId: string,
    slot:      number,
    port:      number,
    onuId:     number,
  ): Promise<{ exitoso: boolean; mensaje: string }> {
    this.assertNotDegraded();
    const olt  = await this.findOlt(oltId, empresaId);
    const conn = await this._buildNativeConn(oltId, empresaId, olt);

    const payload: PythonOntResetRequest = { connection: conn, slot, port, onu_id: onuId };
    const res = await this.automation.ontReset(payload);
    return { exitoso: res.success, mensaje: res.message };
  }

  async topologiaBoard(
    oltId:     string,
    empresaId: string,
  ): Promise<{ exitoso: boolean; slots: any[] }> {
    this.assertNotDegraded();
    const olt  = await this.findOlt(oltId, empresaId);
    const conn = await this._buildNativeConn(oltId, empresaId, olt);

    const payload: PythonBoardTopologyRequest = { connection: conn };
    const res = await this.automation.boardTopology(payload);
    return { exitoso: res.success, slots: res.slots ?? [] };
  }

  async versionOnt(
    oltId:     string,
    empresaId: string,
    slot:      number,
    port:      number,
    onuId:     number,
  ): Promise<{
    exitoso:         boolean;
    ontVersion:      string | null;
    softwareVersion: string | null;
    equipmentId:     string | null;
    error:           string | null;
  }> {
    this.assertNotDegraded();
    const olt  = await this.findOlt(oltId, empresaId);
    const conn = await this._buildNativeConn(oltId, empresaId, olt);

    const payload: PythonOntVersionRequest = { connection: conn, slot, port, onu_id: onuId };
    const res = await this.automation.ontVersion(payload);
    return {
      exitoso:         res.success,
      ontVersion:      res.ont_version      ?? null,
      softwareVersion: res.software_version ?? null,
      equipmentId:     res.equipment_id     ?? null,
      error:           res.error            ?? null,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────

  // Ejecuta fn() a través del Router multi-proveedor.
  // Retorna null si la OLT no tiene olt_proveedor_config activos
  // (SinProveedorConfigException del Router) → activar path legacy.
  // Cualquier otra excepción (incluidos 500 reales) se re-lanza.
  private async _tryRouter<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof SinProveedorConfigException) {
        this.logger.debug(
          `[Router] Sin configs activas → usando path legacy. Detalle: ${err.message}`,
        );
        return null;
      }
      throw err;
    }
  }

  private async findOlt(id: string, empresaId: string): Promise<OltDispositivo> {
    const olt = await this.oltRepo.findOne({ where: { id, empresaId, activo: true } });
    if (!olt) {
      throw new NotFoundException(
        `OLT con ID "${id}" no encontrada o no pertenece a esta empresa`,
      );
    }
    return olt;
  }

  private decryptPassword(contrasenaCifrada: string, ip: string): string {
    try {
      return decrypt(contrasenaCifrada);
    } catch (error) {
      this.logger.error(
        `Error al descifrar credenciales de OLT ${ip}: ${error.message}`,
      );
      throw new ServiceUnavailableException(
        `No se pudo descifrar la contraseña de la OLT. ` +
        `Verifica que ENCRYPTION_KEY no haya cambiado desde que se guardó.`,
      );
    }
  }

  // Extrae y descifra credenciales del proveedor nativo_ssh activo.
  // Lanza BadRequestException si la OLT no tiene proveedor SSH configurado.
  private async _buildNativeConn(
    oltId:     string,
    empresaId: string,
    olt:       OltDispositivo,
  ): Promise<{ ip: string; port: number; username: string; password: string; brand: string }> {
    const config = await this.proveedorRepo.findOne({
      where: { oltId, empresaId, tipo: 'nativo_ssh' as any, activo: true },
    });
    if (!config) throw new BadRequestException('Esta OLT no tiene proveedor nativo_ssh activo');

    const c        = config.credenciales as Record<string, unknown>;
    const password = c.password_cifrado
      ? this.decryptPassword(c.password_cifrado as string, olt.ipGestion)
      : this.decryptPassword(olt.contrasenaCifrada, olt.ipGestion);

    return {
      ip:       (c.ip       as string) || olt.ipGestion,
      port:     ((c.port    as number) || olt.puerto)  ?? 22,
      username: (c.username as string) || olt.usuarioAnclado,
      password,
      brand:    ((c.brand   as string) || olt.marca).toLowerCase(),
    };
  }

  // Expone el health del cliente Python sin romper encapsulamiento.
  async automationHealth(): Promise<unknown> {
    return this.automation.health();
  }

  // ─── IP Validation ────────────────────────────────────────────

  private async _validarIpUnica(ip: string, empresaId: string, excludeId?: string): Promise<void> {
    const rows = await this.ds.query<{ id: string; nombre: string }[]>(
      `SELECT id, nombre FROM olt_dispositivos
       WHERE empresa_id = $1 AND ip_gestion = $2::inet AND activo = true
       ${excludeId ? 'AND id != $3' : ''}`,
      excludeId ? [empresaId, ip, excludeId] : [empresaId, ip],
    );
    if (rows.length > 0) {
      throw new ConflictException(
        `La IP ${ip} ya está en uso por la OLT "${rows[0].nombre}". Cada OLT requiere una IP de gestión única.`,
      );
    }
  }

  async validarIp(ip: string, empresaId: string): Promise<ValidarIpResult> {
    const rows = await this.ds.query<{ id: string; nombre: string; tipo: string | null }[]>(
      `SELECT o.id, o.nombre,
              (SELECT tipo FROM olt_proveedor_config
               WHERE olt_id = o.id AND empresa_id = $1
               ORDER BY prioridad ASC LIMIT 1) AS tipo
       FROM olt_dispositivos o
       WHERE o.empresa_id = $1 AND o.ip_gestion = $2::inet AND o.activo = true
       LIMIT 1`,
      [empresaId, ip],
    );
    if (!rows.length) return { disponible: true };
    const r = rows[0];
    const seccion: 'nativo' | 'smartolt' | 'adminolt' =
      r.tipo === 'smartolt' ? 'smartolt'
      : r.tipo === 'adminolt' ? 'adminolt'
      : 'nativo';
    return { disponible: false, oltNombre: r.nombre, seccion };
  }

  // ─── Creación transaccional OLT + proveedor ────────────────────

  async crearConProveedor(
    empresaId: string,
    tipo: 'smartolt' | 'adminolt',
    dto: CrearOltIntegracionDto,
  ): Promise<OltDispositivo> {
    this.assertNotDegraded();
    await this._validarIpUnica(dto.ipGestion, empresaId);

    const qr = this.ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const apiKeyCifrada = encrypt(dto.apiKey);

      const olt = this.oltRepo.create({
        empresaId,
        nombre:            dto.nombre,
        descripcion:       dto.descripcion ?? null,
        marca:             dto.marca as OltMarca,
        modelo:            dto.modelo ?? null,
        metodoConexion:    OltMetodoConexion.SMARTOLT_API,
        ipGestion:         dto.ipGestion,
        puerto:            80,
        usuarioAnclado:    '',
        contrasenaCifrada: '',
        slotsTotales:      dto.slotsTotales  ?? 1,
        puertosPorSlot:    dto.puertosPorSlot ?? 8,
        routerId:          dto.routerId,
        ubicacion:         dto.ubicacion  ?? null,
        latitud:           dto.latitud    ?? null,
        longitud:          dto.longitud   ?? null,
      });
      const oltGuardada = await qr.manager.save(OltDispositivo, olt);

      const config = this.proveedorRepo.create({
        empresaId,
        oltId:        oltGuardada.id,
        tipo:         tipo as TipoProveedor,
        prioridad:    dto.prioridad ?? 1,
        activo:       true,
        credenciales: {
          base_url:        dto.baseUrl,
          api_key_cifrado: apiKeyCifrada,
          olt_id_externo:  dto.oltIdExterno ?? null,
        },
      });
      await qr.manager.save(OltProveedorConfig, config);

      await qr.commitTransaction();
      return oltGuardada;
    } catch (e) {
      await qr.rollbackTransaction();
      throw e;
    } finally {
      await qr.release();
    }
  }

  // ─── Listar TODAS las OLTs (para /red/olt) ────────────────────

  async listarTodas(empresaId: string): Promise<OltConProveedorPrincipal[]> {
    const rows = await this.ds.query<Array<Record<string, unknown>>>(
      `SELECT
         o.id, o.nombre, o.descripcion, o.marca, o.modelo,
         o.metodo_conexion, o.ip_gestion, o.puerto,
         o.slots_totales, o.puertos_por_slot, o.vlan_gestion_defecto,
         o.estado, o.ultimo_ping, o.onus_activas,
         o.ubicacion, o.latitud, o.longitud, o.activo,
         o.created_at, o.updated_at,
         c.id AS proveedor_id, c.tipo AS proveedor_tipo,
         c.prioridad, c.health_estado, c.health_latencia_ms,
         c.ultimo_health, c.circuit_estado, c.activo AS proveedor_activo
       FROM olt_dispositivos o
       LEFT JOIN LATERAL (
         SELECT id, tipo, prioridad, health_estado, health_latencia_ms,
                ultimo_health, circuit_estado, activo
         FROM olt_proveedor_config
         WHERE olt_id = o.id AND empresa_id = $1
         ORDER BY prioridad ASC
         LIMIT 1
       ) c ON TRUE
       WHERE o.empresa_id = $1 AND o.activo = true
       ORDER BY o.nombre ASC`,
      [empresaId],
    );
    return rows.map(r => ({
      id:                 r.id as string,
      nombre:             r.nombre as string,
      descripcion:        (r.descripcion ?? null) as string | null,
      marca:              r.marca as string,
      modelo:             (r.modelo ?? null) as string | null,
      metodoConexion:     r.metodo_conexion as string,
      ipGestion:          r.ip_gestion as string,
      puerto:             r.puerto as number,
      slotsTotales:       r.slots_totales as number,
      puertosPorSlot:     r.puertos_por_slot as number,
      vlanGestionDefecto: (r.vlan_gestion_defecto ?? null) as number | null,
      estado:             r.estado as string,
      ultimoPing:         (r.ultimo_ping ?? null) as string | null,
      onusActivas:        r.onus_activas as number,
      ubicacion:          (r.ubicacion ?? null) as string | null,
      latitud:            r.latitud != null ? Number(r.latitud) : null,
      longitud:           r.longitud != null ? Number(r.longitud) : null,
      activo:             r.activo as boolean,
      createdAt:          r.created_at as string,
      updatedAt:          r.updated_at as string,
      proveedorPrincipal: r.proveedor_id ? {
        id:               r.proveedor_id as string,
        tipo:             r.proveedor_tipo as string,
        prioridad:        r.prioridad as number,
        healthEstado:     r.health_estado as string,
        healthLatenciaMs: r.health_latencia_ms != null ? Number(r.health_latencia_ms) : null,
        ultimoHealth:     (r.ultimo_health ?? null) as string | null,
        circuitEstado:    r.circuit_estado as string,
        activo:           r.proveedor_activo as boolean,
      } : null,
    }));
  }

  // ── Wizard: topología completa ────────────────────────────────

  async wizardTopologia(
    params: { ip: string; puerto: number; usuario: string; contrasena: string; marca: string },
  ): Promise<PythonWizardTopologyResponse> {
    return this.automation.wizardTopologia({
      connection: {
        ip:       params.ip,
        port:     params.puerto,
        username: params.usuario,
        password: params.contrasena,
        brand:    params.marca.toLowerCase(),
      },
    });
  }

  // ── Wizard: detectar modelo/firmware reales + compatibilidad ──
  // Se llama tras el test SSH exitoso. Nunca lanza — el wizard degrada a
  // selección manual del modelo si la detección falla.
  async detectarVersion(
    params: { ip: string; puerto: number; usuario: string; contrasena: string; marca: string },
  ): Promise<{
    exitoso:  boolean;
    modelo:   string | null;
    firmware: string | null;
    patch:    string | null;
    compatibilidad: EvaluacionCompatibilidad;
    error?:   string;
  }> {
    try {
      const ip  = params.ip.includes('/') ? params.ip.split('/')[0] : params.ip;
      const res = await this.automation.versionInfo({
        connection: {
          ip, port: params.puerto, username: params.usuario,
          password: params.contrasena, brand: params.marca.toLowerCase(),
        },
      });
      if (!res.success) {
        return {
          exitoso: false, modelo: null, firmware: null, patch: null,
          compatibilidad: evaluarCompatibilidadModelo(params.marca, null, null),
          error: res.error,
        };
      }
      const firmware = [res.firmware, res.patch].filter(Boolean).join('/') || null;
      return {
        exitoso:  true,
        modelo:   res.model,
        firmware,
        patch:    res.patch,
        compatibilidad: evaluarCompatibilidadModelo(params.marca, res.model, firmware),
      };
    } catch (e: any) {
      return {
        exitoso: false, modelo: null, firmware: null, patch: null,
        compatibilidad: evaluarCompatibilidadModelo(params.marca, null, null),
        error: e?.response?.data?.message ?? e?.message ?? 'Error al detectar versión',
      };
    }
  }

  // ── Wizard: commit atómico OLT + proveedor SSH ─────────────────

  async wizardCommit(
    empresaId: string,
    dto: WizardCommitDto,
  ): Promise<{ oltId: string }> {
    this.assertNotDegraded();
    await this._validarIpUnica(dto.ipGestion, empresaId);

    // Baseline a asignar (Incremento 10): validar existencia y tenancy ANTES
    // de abrir la transacción — un baselineId ajeno no debe crear la OLT.
    if (dto.baselineId) {
      const [bl] = await this.ds.query<{ id: string }[]>(
        `SELECT id FROM olt_baselines WHERE id = $1 AND empresa_id = $2`,
        [dto.baselineId, empresaId],
      );
      if (!bl) throw new NotFoundException(`Baseline ${dto.baselineId} no encontrado.`);
    }

    const qr = this.ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const contrasenaCifrada = encrypt(dto.contrasena);

      const olt = this.oltRepo.create({
        empresaId,
        nombre:            dto.nombre,
        marca:             dto.marca.toLowerCase() as OltMarca,
        modelo:            dto.modelo ?? null,
        firmware:          dto.firmware ?? null,
        zonaId:            dto.zonaId ?? null,
        metodoConexion:    OltMetodoConexion.NATIVO_SSH,
        ipGestion:         dto.ipGestion,
        puerto:            dto.puerto,
        usuarioAnclado:    dto.usuario,
        contrasenaCifrada,
        ubicacion:         dto.ubicacion ?? null,
        latitud:           dto.latitud ?? null,
        longitud:          dto.longitud ?? null,
        descripcion:       dto.descripcion ?? null,
        baselineId:        dto.baselineId ?? null,
        activo:            true,
      });
      const saved = await qr.manager.save(olt);

      await qr.manager.save(OltProveedorConfig, {
        oltId:          saved.id,
        empresaId,
        tipo:           'nativo_ssh' as TipoProveedor,
        prioridad:      1,
        activo:         true,
        circuitEstado:  'closed',
        circuitFallas:  0,
        credenciales: {
          ip:               dto.ipGestion.includes('/') ? dto.ipGestion.split('/')[0] : dto.ipGestion,
          port:             dto.puerto,
          username:         dto.usuario,
          password_cifrado: contrasenaCifrada,
          brand:            dto.marca.toLowerCase(),
        },
      });

      await qr.commitTransaction();
      return { oltId: saved.id };
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  private async persistirMetricasOnu(
    sn:       string,
    rxPower:  number | null,
    txPower:  number | null,
    tempC:    number | null,
  ): Promise<void> {
    try {
      const updates: Partial<Onu> = {
        ultimoOnline: new Date(),
        estado:       EstadoOnu.ONLINE,
      };
      if (rxPower !== null) updates.rxPowerDbm  = rxPower;
      if (txPower !== null) updates.txPowerDbm  = txPower;
      if (tempC   !== null) updates.temperaturaC = tempC;

      await this.onuRepo.update({ serialNumber: sn.toUpperCase() }, updates);
    } catch (error) {
      // No propagamos — las métricas son best-effort, no críticas
      this.logger.warn(
        `No se pudieron persistir métricas para SN=${sn}: ${error.message}`,
      );
    }
  }

  // ── Log de eventos paginado (página de detalle OLT) ───────────

  async listarEventos(
    oltId: string, empresaId: string, take: number, skip: number,
  ): Promise<{ data: any[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.ds.query<any[]>(
        `SELECT
           id,
           onu_sn              AS "onuSn",
           tipo,
           estado,
           proveedor_exitoso   AS "proveedorExitoso",
           proveedores_intentados AS "proveedoresIntentados",
           error_mensaje       AS "errorMensaje",
           duracion_ms         AS "duracionMs",
           usuario_id          AS "usuarioId",
           created_at          AS "createdAt"
         FROM olt_operacion_log
         WHERE olt_id = $1 AND empresa_id = $2
         ORDER BY created_at DESC
         LIMIT $3 OFFSET $4`,
        [oltId, empresaId, take, skip],
      ),
      this.ds.query<{ count: string }[]>(
        `SELECT COUNT(*) AS count FROM olt_operacion_log
         WHERE olt_id = $1 AND empresa_id = $2`,
        [oltId, empresaId],
      ).then(r => parseInt(r[0].count, 10)),
    ]);
    return { data: rows, total };
  }
}
