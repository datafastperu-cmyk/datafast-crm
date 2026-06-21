import {
  BadRequestException, Injectable, Logger, NotFoundException,
  OnModuleInit, ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository }             from 'typeorm';
import { ModuleHealthService }                from '../../common/services/module-health.service';

import { OltDispositivo, OltMetodoConexion } from './entities/olt-dispositivo.entity';
import { Onu, EstadoOnu }  from '../smartolt/entities/onu.entity';
import { SmartoltApiService, ProvisionarOnuPayload } from '../smartolt/smartolt-api.service';
import { OltAutomationClient } from './olt-automation.client';
import { decrypt, encrypt }    from '../../common/utils/encryption.util';
import {
  DiscoverResult,
  MetricasOnuResult,
  ObtenerMetricasDto,
  ProvisionarOnuNativaDto,
  ProvisionResult,
  PythonDiscoverRequest,
  PythonProvisionRequest,
} from './dto/olt-nativo-ops.dto';
import { CreateOltDispositivoDto, UpdateOltDispositivoDto } from './dto/olt-dispositivo.dto';

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

    @InjectRepository(Onu)
    private readonly onuRepo: Repository<Onu>,

    private readonly smartoltApi:  SmartoltApiService,
    private readonly automation:   OltAutomationClient,
    private readonly moduleHealth: ModuleHealthService,
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

    // ── Routing híbrido ───────────────────────────────────────
    if (olt.metodoConexion === OltMetodoConexion.SMARTOLT_API) {
      return this.provisionarViaSmartolt(olt, dto);
    }

    if (olt.metodoConexion === OltMetodoConexion.NATIVO_SNMP) {
      throw new ServiceUnavailableException(
        'Las OLTs con método NATIVO_SNMP no soportan aprovisionamiento CLI. ' +
        'Cambia el método a NATIVO_SSH o SMARTOLT_API.',
      );
    }

    // NATIVO_SSH → Python microservice
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

    if (olt.metodoConexion === OltMetodoConexion.SMARTOLT_API) {
      // SmartOLT API tiene su propio endpoint de señal
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
    const t0 = Date.now();
    try {
      const res = await this.automation.discoverOnus({
        connection: { ip: params.ip, port: params.puerto, username: params.usuario, password: params.password, brand: params.marca.toLowerCase() },
        slot: null,
        port: null,
      });
      const latenciaMs = Date.now() - t0;
      if (res.success) {
        return { exitoso: true, mensaje: `Conexión SSH exitosa — ${res.total} ONU(s) no autorizadas`, latenciaMs };
      }
      return { exitoso: false, mensaje: res.error ?? 'Error al conectar con la OLT', latenciaMs };
    } catch (e: any) {
      const latenciaMs = Date.now() - t0;
      const msg = e?.response?.data?.message || e?.message || 'Error desconocido';
      return { exitoso: false, mensaje: msg, latenciaMs };
    }
  }

  async listar(empresaId: string): Promise<OltDispositivo[]> {
    return this.oltRepo.find({
      where: { empresaId, activo: true },
      order: { nombre: 'ASC' },
    });
  }

  async findOne(id: string, empresaId: string): Promise<OltDispositivo> {
    return this.findOlt(id, empresaId);
  }

  async crear(empresaId: string, dto: CreateOltDispositivoDto): Promise<OltDispositivo> {
    const { contrasena, ...rest } = dto;
    const contrasenaCifrada = encrypt(contrasena);
    const olt = this.oltRepo.create({ ...rest, empresaId, contrasenaCifrada });
    return this.oltRepo.save(olt);
  }

  async actualizar(id: string, empresaId: string, dto: UpdateOltDispositivoDto): Promise<OltDispositivo> {
    const olt = await this.findOlt(id, empresaId);
    const { contrasena, ...rest } = dto;
    if (contrasena) {
      olt.contrasenaCifrada = encrypt(contrasena);
    }
    const defined = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    Object.assign(olt, defined);
    return this.oltRepo.save(olt);
  }

  async eliminar(id: string, empresaId: string): Promise<void> {
    const olt = await this.findOlt(id, empresaId);
    olt.activo = false;
    await this.oltRepo.save(olt);
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

  // ─── Helpers ──────────────────────────────────────────────────

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
}
