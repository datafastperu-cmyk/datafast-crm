import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';

import { decrypt }             from '../../../common/utils/encryption.util';
import { OltDispositivo }      from '../entities/olt-dispositivo.entity';
import { OltProveedorConfig }  from '../entities/olt-proveedor-config.entity';
import {
  IOltProvider,
  OltDeprovisionDatos,
  OltDeprovisionPayload,
  OltMetricasDatos,
  OltMetricasPayload,
  OltOnuEncontrada,
  OltOperacionResult,
  OltProvisionDatos,
  OltProvisionPayload,
  ProveedorCredenciales,
} from '../interfaces/olt-provider.interface';
import { OltProviderRegistry }   from './olt-provider-registry.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { OltAtomicLockService }  from './olt-atomic-lock.service';
import {
  OltIdempotencyService,
  IdempotencyContext,
} from './olt-idempotency.service';

// Excepción tipada: la OLT no tiene configs activas en olt_proveedor_config.
// Permite a los llamadores (_tryRouter) distinguir "activar path legacy" de un
// error 500 real, que antes se enmascaraba por ser la misma clase.
export class SinProveedorConfigException extends InternalServerErrorException {}

// ─────────────────────────────────────────────────────────────
// OltOperationRouter  —  orquestador central del ecosistema
//
// Flujo para operaciones MUTANTES (provisionar / desaprovisionar):
//   1. Cargar OltDispositivo + OltProveedorConfig[] (por prioridad)
//   2. OltAtomicLockService.withLock(oltId, onuSn, …)
//      → garantía de exclusión mutua por ONU
//   3. OltIdempotencyService.execute(ctx, …)
//      → retorna resultado cacheado si ya se ejecutó con éxito
//   4. _iterarProveedores() con circuit breaker por proveedor
//      → registra intento, avanza al siguiente si falla
//
// Flujo para operaciones DE LECTURA (descubrir / métricas / test):
//   Sin lock ni idempotencia — _iterarProveedores() directamente.
//
// PEOR ESCENARIO CUBIERTO:
//   - Sin configs activas → InternalServerErrorException con mensaje claro.
//   - Todos los proveedores OPEN → mensaje de degradación por circuit breaker.
//   - fn() lanza inesperadamente → OltIdempotencyService lo captura,
//     registra 'fallido' y re-lanza.
//   - Error al descifrar → creds.password = undefined; el provider
//     detectará credencial vacía y retornará exitoso:false.
// ─────────────────────────────────────────────────────────────
@Injectable()
export class OltOperationRouter {
  private readonly logger = new Logger(OltOperationRouter.name);

  constructor(
    @InjectRepository(OltDispositivo)
    private readonly oltRepo:    Repository<OltDispositivo>,

    @InjectRepository(OltProveedorConfig)
    private readonly configRepo: Repository<OltProveedorConfig>,

    private readonly registry:    OltProviderRegistry,
    private readonly breaker:     CircuitBreakerService,
    private readonly atomicLock:  OltAtomicLockService,
    private readonly idempotency: OltIdempotencyService,
  ) {}

  // ═══════════════════════════════════════════════════════════
  // API PÚBLICA
  // ═══════════════════════════════════════════════════════════

  // ── Test de conectividad — sin lock, sin idempotencia ────────
  async testConexion(
    empresaId: string,
    oltId:     string,
  ): Promise<OltOperacionResult> {
    const { olt, configs } = await this._cargar(empresaId, oltId);
    return this._iterar(olt, configs, null, (p, creds) =>
      p.testConexion(olt, creds),
    );
  }

  // ── Test de un proveedor específico por configId ─────────────
  async testConexionPorConfig(
    empresaId: string,
    configId:  string,
  ): Promise<OltOperacionResult> {
    const config = await this.configRepo.findOne({ where: { id: configId, empresaId } });
    if (!config) {
      throw new NotFoundException(`Configuración de proveedor ${configId} no encontrada`);
    }

    const olt = await this.oltRepo.findOne({
      where: { id: config.oltId, deletedAt: IsNull() as any },
    });
    if (!olt) throw new NotFoundException(`OLT ${config.oltId} no encontrada`);

    const provider = this.registry.get(config.tipo);
    const creds    = this._buildCreds(config);
    return provider.testConexion(olt, creds);
  }

  // ── Descubrir ONUs — lectura, sin lock ───────────────────────
  async descubrirOnus(
    empresaId: string,
    oltId:     string,
    slot?:     number,
    port?:     number,
  ): Promise<OltOperacionResult<OltOnuEncontrada[]>> {
    const { olt, configs } = await this._cargar(empresaId, oltId);
    return this._iterar(olt, configs, null, (p, creds) =>
      p.descubrirOnus(olt, creds, slot, port),
    );
  }

  // ── Métricas ópticas — lectura, sin lock ─────────────────────
  async obtenerMetricas(
    empresaId: string,
    oltId:     string,
    payload:   OltMetricasPayload,
  ): Promise<OltOperacionResult<OltMetricasDatos>> {
    const { olt, configs } = await this._cargar(empresaId, oltId);
    return this._iterar(olt, configs, null, (p, creds) =>
      p.obtenerMetricas(olt, creds, payload),
    );
  }

  // ── Provisionar — lock + idempotencia + fallback ─────────────
  async provisionar(
    empresaId:  string,
    oltId:      string,
    payload:    OltProvisionPayload,
    usuarioId?: string | null,
  ): Promise<OltOperacionResult<OltProvisionDatos>> {

    const { olt, configs } = await this._cargar(empresaId, oltId);

    return this.atomicLock.withLock(oltId, payload.sn, async () => {

      const ctx: IdempotencyContext = {
        tipo:      'provision',
        empresaId,
        oltId,
        onuSn:     payload.sn,
        payload:   { sn: payload.sn, slot: payload.slot, port: payload.port,
                     vlan: payload.vlan, profileSpeed: payload.profileSpeed },
        usuarioId: usuarioId ?? null,
      };

      const { resultado } = await this.idempotency.execute(ctx, (logId) =>
        this._iterar(olt, configs, logId, (p, creds) =>
          p.provisionar(olt, creds, payload),
        ),
      );

      return resultado as OltOperacionResult<OltProvisionDatos>;
    });
  }

  // ── Desaprovisionar — lock + idempotencia + fallback ─────────
  async desaprovisionar(
    empresaId:  string,
    oltId:      string,
    payload:    OltDeprovisionPayload,
    usuarioId?: string | null,
  ): Promise<OltOperacionResult<OltDeprovisionDatos>> {

    const { olt, configs } = await this._cargar(empresaId, oltId);

    return this.atomicLock.withLock(oltId, payload.sn, async () => {

      const ctx: IdempotencyContext = {
        tipo:      'deprovision',
        empresaId,
        oltId,
        onuSn:     payload.sn,
        payload:   { sn: payload.sn, slot: payload.slot, port: payload.port },
        usuarioId: usuarioId ?? null,
      };

      const { resultado } = await this.idempotency.execute(ctx, (logId) =>
        this._iterar(olt, configs, logId, (p, creds) =>
          p.desaprovisionar(olt, creds, payload),
        ),
      );

      return resultado as OltOperacionResult<OltDeprovisionDatos>;
    });
  }

  // ═══════════════════════════════════════════════════════════
  // PRIVADOS
  // ═══════════════════════════════════════════════════════════

  // ── Carga OLT + configs activas en orden de prioridad ────────
  private async _cargar(
    empresaId: string,
    oltId:     string,
  ): Promise<{ olt: OltDispositivo; configs: OltProveedorConfig[] }> {

    const olt = await this.oltRepo.findOne({
      where: { id: oltId, empresaId, deletedAt: IsNull() as any },
    });
    if (!olt) throw new NotFoundException(`OLT ${oltId} no encontrada`);

    const configs = await this.configRepo.find({
      where: { oltId, empresaId, activo: true },
      order: { prioridad: 'ASC' },
    });

    if (configs.length === 0) {
      throw new SinProveedorConfigException(
        `OLT ${olt.nombre} (${oltId}) no tiene proveedores activos configurados en olt_proveedor_config`,
      );
    }

    return { olt, configs };
  }

  // ── Bucle de fallback con circuit breaker ────────────────────
  // Itera providers en orden de prioridad.
  // logId !== null → registra cada intento en olt_operacion_log.
  private async _iterar<T>(
    olt:       OltDispositivo,
    configs:   OltProveedorConfig[],
    logId:     string | null,
    operacion: (
      provider: IOltProvider,
      creds:    ProveedorCredenciales,
      config:   OltProveedorConfig,
    ) => Promise<OltOperacionResult<T>>,
  ): Promise<OltOperacionResult<T>> {

    const errores: string[] = [];
    let   ultimoTipo = configs[0].tipo;

    for (const config of configs) {
      ultimoTipo = config.tipo;

      // ── Verificar circuit breaker ──────────────────────────
      const puedeIntentar = await this.breaker.canAttempt(config);
      if (!puedeIntentar) {
        this.logger.warn(
          `[Router] Circuit OPEN — saltando ${config.tipo} para OLT=${olt.nombre}`,
        );
        errores.push(`${config.tipo}: circuit breaker abierto`);
        continue;
      }

      // ── Resolver proveedor y credenciales ──────────────────
      const provider = this.registry.get(config.tipo);
      const creds    = this._buildCreds(config);

      this.logger.log(
        `[Router] Intentando ${config.tipo} | OLT=${olt.nombre} | prioridad=${config.prioridad}`,
      );

      // ── Ejecutar operación ─────────────────────────────────
      const resultado = await operacion(provider, creds, config);

      // ── Registrar intento en log de auditoría ──────────────
      if (logId) {
        await this.idempotency.registrarIntento(logId, config.tipo).catch(() => {
          // No bloquear la operación por un fallo de logging
        });
      }

      if (resultado.exitoso) {
        await this.breaker.recordSuccess(config);
        this.logger.log(
          `[Router] Éxito vía ${config.tipo} | OLT=${olt.nombre} | ` +
          `latencia=${resultado.latenciaMs}ms`,
        );
        return resultado;
      }

      // Fallo de este proveedor → anotar y pasar al siguiente
      await this.breaker.recordFailure(config);
      errores.push(`${config.tipo}: ${resultado.mensaje}`);
      this.logger.warn(
        `[Router] Fallo ${config.tipo} | OLT=${olt.nombre} | ${resultado.mensaje}`,
      );
    }

    // Todos los proveedores fallaron
    const mensajeAgregado =
      `Todos los proveedores fallaron para OLT "${olt.nombre}". ` +
      errores.join(' | ');

    this.logger.error(`[Router] ${mensajeAgregado}`);

    return {
      exitoso:    false,
      mensaje:    mensajeAgregado,
      latenciaMs: 0,
      proveedor:  ultimoTipo,
    };
  }

  // ── Descifrar y mapear credenciales desde JSONB ──────────────
  private _buildCreds(config: OltProveedorConfig): ProveedorCredenciales {
    const c = config.credenciales as Record<string, any>;

    let password: string | undefined;
    if (c.password_cifrado) {
      try   { password = decrypt(c.password_cifrado); }
      catch { this.logger.error(`No se pudo descifrar password para config ${config.id}`); }
    }

    let apiKey: string | undefined;
    if (c.api_key_cifrado) {
      try   { apiKey = decrypt(c.api_key_cifrado); }
      catch { this.logger.error(`No se pudo descifrar api_key para config ${config.id}`); }
    }

    return {
      // Nativo SSH / SNMP
      ip:            c.ip,
      port:          typeof c.port === 'number' ? c.port : 22,
      username:      c.username,
      password,
      brand:         c.brand,
      snmpCommunity: c.snmp_community,
      snmpVersion:   c.snmp_version,
      // SmartOLT / AdminOLT
      baseUrl:       c.base_url,
      apiKey,
      oltIdExterno:  c.olt_id_externo,
    };
  }
}
