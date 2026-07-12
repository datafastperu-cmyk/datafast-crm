import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository }   from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { SchedulerRegistry }  from '@nestjs/schedule';
import { CronJob }            from 'cron';
import pLimit                 from 'p-limit';

import { decrypt }            from '../../../common/utils/encryption.util';
import { OltDispositivo }     from '../entities/olt-dispositivo.entity';
import {
  OltProveedorConfig,
  HealthEstado,
} from '../entities/olt-proveedor-config.entity';
import { ProveedorCredenciales } from '../interfaces/olt-provider.interface';
import { OltProviderRegistry }   from './olt-provider-registry.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { EmpresaConfigService }  from '../../config/empresa-config.service';

// ─────────────────────────────────────────────────────────────
// OltHealthMonitorService
//
// Cron cada 5 minutos (misma ventana que OltMonitoreoService).
// Solo corre en instancia PM2 #0 (evita N workers haciendo lo mismo).
//
// Por cada OltProveedorConfig activa:
//   1. Llama provider.testConexion(olt, creds) directamente
//      (sin pasar por el Router — no genera lock ni log de operación).
//   2. Actualiza: health_estado, ultimo_health, health_latencia_ms.
//   3. Si testConexion fue exitosa Y el circuit estaba OPEN →
//      llama breaker.recordSuccess() para iniciar recuperación.
//      Los fallos del health check NO alimentan el circuit breaker
//      (eso es responsabilidad de las operaciones reales vía Router).
//
// Concurrencia: pLimit(5) — máx 5 OLTs probando simultáneamente.
// Anti-solapamiento: flag `_running` previene ejecuciones paralelas
// si una vuelta tarda más de 5 min (OLTs lentas o muchas).
// ─────────────────────────────────────────────────────────────
@Injectable()
export class OltHealthMonitorService implements OnModuleInit {
  private readonly logger  = new Logger(OltHealthMonitorService.name);
  private          _running = false;

  constructor(
    @InjectRepository(OltDispositivo)
    private readonly oltRepo:    Repository<OltDispositivo>,

    @InjectRepository(OltProveedorConfig)
    private readonly configRepo: Repository<OltProveedorConfig>,

    private readonly registry: OltProviderRegistry,
    private readonly breaker:  CircuitBreakerService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly empresaConfig:     EmpresaConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.RUN_CRONS !== 'true') return;
    const tz = await this.empresaConfig.getTimezone().catch(() => 'America/Lima');
    const job = new CronJob('*/5 * * * *', () => this.checkAll(), null, true, tz);
    this.schedulerRegistry.addCronJob('olt-health-monitor-check-all', job);
  }

  // ────────────────────────────────────────────────────────────
  // CRON — cada 5 minutos, solo instancia PM2 #0
  // ────────────────────────────────────────────────────────────
  async checkAll(): Promise<void> {
    if (process.env.NODE_APP_INSTANCE !== undefined &&
        process.env.NODE_APP_INSTANCE !== '0') return;

    if (this._running) {
      this.logger.warn('OltHealthMonitor: vuelta anterior aún en curso — omitiendo');
      return;
    }

    this._running = true;
    const t0 = Date.now();

    try {
      await this._ejecutar();
    } catch (err: any) {
      this.logger.error(`OltHealthMonitor: error inesperado — ${err.message}`);
    } finally {
      this._running = false;
      this.logger.log(`OltHealthMonitor: vuelta completada en ${Date.now() - t0}ms`);
    }
  }

  // ────────────────────────────────────────────────────────────
  // Lógica principal
  // ────────────────────────────────────────────────────────────
  private async _ejecutar(): Promise<void> {
    // Cargar todas las configs activas + sus OLTs en dos queries
    const configs = await this.configRepo.find({
      where: { activo: true },
      order: { empresaId: 'ASC', oltId: 'ASC', prioridad: 'ASC' },
    });

    if (configs.length === 0) return;

    // Precargar OLTs únicas para evitar N+1
    const oltIds = [...new Set(configs.map((c) => c.oltId))];
    const olts   = await this.oltRepo.findByIds(oltIds);
    const oltMap = new Map(olts.map((o) => [o.id, o]));

    // Solo monitorear configs cuya OLT está activa (evita disparar SSH a entradas inactivas)
    const activeConfigs = configs.filter((c) => oltMap.get(c.oltId)?.activo !== false);

    if (activeConfigs.length === 0) return;

    this.logger.log(
      `OltHealthMonitor: ${activeConfigs.length} OLT(s) a procesar`,
    );

    // pLimit(3) — máx 3 OLTs concurrentes; evita saturar SSH cuando hay varias en la misma IP
    const limit = pLimit(3);

    await Promise.all(
      activeConfigs.map((config) =>
        limit(() => this._checkConfig(config, oltMap.get(config.oltId))),
      ),
    );
  }

  // ────────────────────────────────────────────────────────────
  // Health check de una OltProveedorConfig individual
  // ────────────────────────────────────────────────────────────
  private async _checkConfig(
    config: OltProveedorConfig,
    olt:    OltDispositivo | undefined,
  ): Promise<void> {
    if (!olt) {
      this.logger.warn(`OltHealthMonitor: OLT ${config.oltId} no encontrada — saltando`);
      return;
    }

    // Verificar que el tipo de proveedor está registrado antes de intentar
    if (!this.registry.has(config.tipo)) {
      this.logger.warn(
        `OltHealthMonitor: proveedor "${config.tipo}" no registrado — saltando config ${config.id}`,
      );
      return;
    }

    const provider = this.registry.get(config.tipo);
    const creds    = this._buildCreds(config);
    const t0       = Date.now();

    let healthEstado:  HealthEstado;
    let latenciaMs:    number;
    let exitoso:       boolean;

    try {
      const resultado = await provider.testConexion(olt, creds);
      latenciaMs  = Date.now() - t0;
      exitoso     = resultado.exitoso;
      healthEstado = resultado.exitoso ? 'ok' : 'down';

      this.logger.debug(
        `OltHealthMonitor: ${config.tipo} | OLT=${olt.nombre} | ` +
        `${healthEstado} | ${latenciaMs}ms`,
      );
    } catch (err: any) {
      // IOltProvider nunca debe lanzar, pero como red de seguridad:
      latenciaMs   = Date.now() - t0;
      exitoso      = false;
      healthEstado = 'down';
      this.logger.error(
        `OltHealthMonitor: ${config.tipo} | OLT=${olt.nombre} | excepción inesperada: ${err.message}`,
      );
    }

    // ── Actualizar campos de salud en BD ──────────────────────
    await this.configRepo.update(config.id, {
      healthEstado,
      ultimoHealth:      new Date(),
      healthLatenciaMs:  latenciaMs,
    });

    // ── Recuperación de circuit breaker ───────────────────────
    // Si el health check pasa y el circuit estaba OPEN → señalar éxito
    // para que pase a HALF_OPEN (o CLOSED si venía de HALF_OPEN).
    // Si el health check falla → no penalizar el circuit (eso lo hace
    // el Router cuando una operación real falla).
    if (exitoso && config.circuitEstado === 'open') {
      const updatedConfig = { ...config, circuitEstado: config.circuitEstado };
      await this.breaker.recordSuccess(updatedConfig as OltProveedorConfig);
      this.logger.log(
        `OltHealthMonitor: circuit recovery señalizado para ${config.tipo} | OLT=${olt.nombre}`,
      );
    }
  }

  // ── Descifrar y mapear credenciales desde JSONB ──────────────
  private _buildCreds(config: OltProveedorConfig): ProveedorCredenciales {
    const c = config.credenciales as Record<string, any>;

    let password: string | undefined;
    if (c.password_cifrado) {
      try   { password = decrypt(c.password_cifrado); }
      catch { /* credencial corrupta — el provider retornará exitoso:false */ }
    }

    let apiKey: string | undefined;
    if (c.api_key_cifrado) {
      try   { apiKey = decrypt(c.api_key_cifrado); }
      catch { /* credencial corrupta */ }
    }

    return {
      ip:            c.ip,
      port:          typeof c.port === 'number' ? c.port : 22,
      username:      c.username,
      password,
      brand:         c.brand,
      snmpCommunity: c.snmp_community,
      snmpVersion:   c.snmp_version,
      baseUrl:       c.base_url,
      apiKey,
      oltIdExterno:  c.olt_id_externo,
    };
  }
}
