import {
  Injectable, Logger, NotFoundException, UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { ContratoOnuConfig } from '../entities/contrato-onu-config.entity';
import { decrypt } from '../../../common/utils/encryption.util';
import { DesiredConfiguration, ExecutionPlan } from './ztp.contracts';
import { filterByCapabilities } from './capability.engine';
import { resolve } from './resolver';
import { DeviceRuntime, getParameterMap, matchDeviceProfile } from './registry';
import { GenieAcsDriver } from './genieacs.driver';
import { ContratoOnuConfigService } from './contrato-onu-config.service';

// ═══════════════════════════════════════════════════════════════════════════
// ZtpProvisioningService — orquestador del pipeline (lado ERP)
//
//   contrato_onu_config + contrato → DesiredConfiguration
//   Runtime GenieACS → DeviceProfile (+ ParameterMap)
//   Capability Engine → filtra → Resolver → ExecutionPlan
//
// NO toca GenieACS ni la ONU: recibe el Runtime y devuelve el ExecutionPlan. El push
// del plan por NBI + ConnectionRequest es responsabilidad del driver GenieACS (Inc. 2).
// ═══════════════════════════════════════════════════════════════════════════
@Injectable()
export class ZtpProvisioningService {
  private readonly logger = new Logger(ZtpProvisioningService.name);

  constructor(
    @InjectDataSource()
    private readonly ds: DataSource,
    @InjectRepository(ContratoOnuConfig)
    private readonly configRepo: Repository<ContratoOnuConfig>,
    private readonly driver: GenieAcsDriver,
    private readonly onuConfig: ContratoOnuConfigService,
  ) {}

  private _dec(v: string | null): string | undefined {
    if (!v) return undefined;
    try { return decrypt(v); } catch { return v; /* no cifrado (legacy) */ }
  }

  // ── buildDesiredConfiguration ─────────────────────────────────────────────
  // Objeto de NEGOCIO. Combina la config de servicio de la ONU (contrato_onu_config)
  // con las credenciales del contrato (PPPoE) y su modo WAN.
  async buildDesiredConfiguration(
    contratoId: string,
    empresaId:  string,
  ): Promise<DesiredConfiguration> {
    const cfg = await this.configRepo.findOne({ where: { contratoId, empresaId } });
    if (!cfg) {
      throw new NotFoundException(
        `El contrato ${contratoId} no tiene config de ONU (contrato_onu_config). Créala antes de aprovisionar.`,
      );
    }

    const [c] = await this.ds.query<{
      usuario_pppoe:  string | null;
      password_pppoe: string | null;
      vlan_id:        number | null;
    }[]>(
      `SELECT usuario_pppoe, password_pppoe, vlan_id
       FROM   contratos
       WHERE  id = $1 AND empresa_id = $2 AND deleted_at IS NULL`,
      [contratoId, empresaId],
    );

    // Modo WAN de la ONU + perfil TR-069 de su OLT (credenciales CWMP para auth ONU→ACS).
    const [reg] = await this.ds.query<{
      wan_mode: string | null;
      tr069_enabled: boolean | null;
      tr069_acs_username: string | null;
      tr069_acs_password: string | null;
    }[]>(
      `SELECT r.wan_mode, o.tr069_enabled, o.tr069_acs_username, o.tr069_acs_password
       FROM   ftth_onu_registro r
       JOIN   olt_dispositivos  o ON o.id = r.olt_id
       WHERE  r.contrato_id = $1 AND r.empresa_id = $2`,
      [contratoId, empresaId],
    );
    const esRouting = (reg?.wan_mode ?? 'bridge') === 'routing';

    const wifiOn = cfg.wifiEnabled && !!cfg.wifiSsid;
    const pppoe  = esRouting && !!c?.usuario_pppoe;

    return {
      schemaVersion: 1,
      metadata: {
        revision:     cfg.revision,
        generated_at: new Date().toISOString(),
        generated_by: 'ERP',
      },
      wifi: {
        enabled:    wifiOn,
        ssid:       cfg.wifiSsid ?? '',
        password:   this._dec(cfg.wifiPassword) ?? '',
        ssid5g:     cfg.wifi5gSsid ?? undefined,
        password5g: this._dec(cfg.wifi5gPassword),
      },
      internet: pppoe
        ? { enabled: true, type: 'pppoe', username: c!.usuario_pppoe!,
            password: this._dec(c!.password_pppoe), vlan: c!.vlan_id ?? undefined }
        : { enabled: false, type: 'bridge' },
      management: reg?.tr069_enabled && (!!reg?.tr069_acs_username || !!cfg.connReqUsername)
        ? {
            acsUsername: reg.tr069_acs_username ?? undefined,
            acsPassword: this._dec(reg.tr069_acs_password),
            connReqUsername: cfg.connReqUsername ?? undefined,
            connReqPassword: this._dec(cfg.connReqPassword),
          }
        : undefined,
      voip: cfg.voipEnabled && !!cfg.voipUser
        ? { enabled: true, user: cfg.voipUser, password: this._dec(cfg.voipPassword) }
        : { enabled: false },
      onuAdmin: cfg.onuAdminEnabled
        ? {
            enabled: true,
            user:     cfg.onuAdminUser ?? undefined,
            password: this._dec(cfg.onuAdminPassword),
            webUser:         cfg.onuWebUser ?? undefined,
            webUserPassword: this._dec(cfg.onuWebUserPassword),
            cliUser:         cfg.onuCliUser ?? undefined,
            cliPassword:     this._dec(cfg.onuCliPassword),
          }
        : { enabled: false },
    };
  }

  // ── buildExecutionPlan ────────────────────────────────────────────────────
  // Cadena completa: DesiredConfiguration → (perfil por Runtime) → filtro → resolver.
  async buildExecutionPlan(
    contratoId: string,
    empresaId:  string,
    deviceId:   string,
    runtime:    DeviceRuntime,
  ): Promise<ExecutionPlan> {
    const desired = await this.buildDesiredConfiguration(contratoId, empresaId);

    const profile = matchDeviceProfile(runtime);
    if (!profile) {
      throw new UnprocessableEntityException(
        `No hay device-profile para el modelo reportado ` +
        `(model=${runtime.modelName ?? '?'} class=${runtime.productClass ?? '?'}). ` +
        `Agrega su perfil al registry ZTP.`,
      );
    }
    const pmap = getParameterMap(profile.parameter_map);
    if (!pmap) {
      throw new UnprocessableEntityException(
        `El parameter_map "${profile.parameter_map}" del perfil ${profile.vendor} ${profile.model} no está registrado.`,
      );
    }

    const filtered = filterByCapabilities(desired, profile);
    const plan = resolve(deviceId, filtered, profile, pmap);

    this.logger.log(
      `ExecutionPlan | contrato=${contratoId} device=${deviceId} ` +
      `profile=${plan.profile} writes=${plan.writes.length} rev=${plan.metadata.revision}`,
    );
    return plan;
  }

  // ── provisionContract ─────────────────────────────────────────────────────
  // Flujo ERP-driven completo: busca el device en GenieACS por el SN de la ONU, lee su
  // Runtime, produce el ExecutionPlan y lo aplica por NBI (con ConnectionRequest).
  // GUARD: solo aplica si contrato_onu_config.provisioning_enabled = true (seguridad).
  async provisionContract(
    contratoId: string,
    empresaId:  string,
  ): Promise<{ ok: boolean; skipped?: boolean; deviceId?: string; applied?: number; total?: number; fallidas?: string[]; mensaje: string }> {
    const cfg = await this.configRepo.findOne({ where: { contratoId, empresaId } });
    if (!cfg) {
      throw new NotFoundException(`El contrato ${contratoId} no tiene config de ONU (contrato_onu_config).`);
    }
    if (!cfg.provisioningEnabled) {
      return { ok: false, skipped: true,
        mensaje: 'provisioning_enabled = false. Actívalo explícitamente antes de aplicar (seguridad ZTP).' };
    }
    if (!this.driver.isReady()) {
      return { ok: false, mensaje: 'GenieACS NBI no configurado — el pipeline TR-069 está degradado.' };
    }

    const [reg] = await this.ds.query<{ sn: string | null }[]>(
      `SELECT sn FROM ftth_onu_registro WHERE contrato_id = $1 AND empresa_id = $2`,
      [contratoId, empresaId],
    );
    if (!reg?.sn) {
      throw new NotFoundException('El contrato no tiene ONU aprovisionada (sin SN).');
    }

    // Garantiza credenciales ConnectionRequest únicas por ONU antes de armar el plan
    // (se aplicarán si la OLT tiene TR-069 habilitado). Idempotente.
    await this.onuConfig.ensureConnReq(contratoId, empresaId, reg.sn);

    const deviceId = await this.driver.findDeviceIdBySerial(reg.sn);
    if (!deviceId) {
      return { ok: false, mensaje: `La ONU ${reg.sn} aún no aparece en GenieACS (no ha informado).` };
    }
    const runtime = await this.driver.getRuntime(deviceId);
    if (!runtime) {
      return { ok: false, deviceId, mensaje: 'No se pudo leer el Runtime del device desde GenieACS.' };
    }

    const profile = matchDeviceProfile(runtime);
    if (!profile) {
      throw new UnprocessableEntityException(
        `Sin device-profile para el modelo reportado (class=${runtime.productClass ?? '?'}).`,
      );
    }
    const pmap = getParameterMap(profile.parameter_map);
    if (!pmap) {
      throw new UnprocessableEntityException(`parameter_map "${profile.parameter_map}" no registrado.`);
    }

    const plan = await this.buildExecutionPlan(contratoId, empresaId, deviceId, runtime);
    const res  = await this.driver.applyExecutionPlan(plan, pmap);

    const fallidas = res.results.filter((r) => !r.ok);
    const ok = fallidas.length === 0;
    const mensaje =
      `Plan aplicado a ${deviceId}: ${res.applied}/${plan.writes.length} escrituras` +
      (fallidas.length ? ` — fallaron: ${fallidas.map((r) => r.key).join(', ')}` : ' (todas OK)') + '.';

    // Estado aplicado (Inc.3): la revisión solo "queda aplicada" si TODO el plan pasó.
    // Un plan parcial sigue en drift → la reconciliación reintentará.
    await this.configRepo.update(
      { id: cfg.id },
      {
        lastProvisionedAt:   new Date(),
        lastProvisionResult: mensaje.slice(0, 500),
        ...(ok ? { lastAppliedRevision: plan.metadata.revision } : {}),
      },
    );

    return {
      ok,
      deviceId,
      applied: res.applied,
      total: plan.writes.length,
      fallidas: fallidas.map((r) => `${r.key}(${r.fault ?? r.reason})`),
      mensaje,
    };
  }

  // ── reconcile ─────────────────────────────────────────────────────────────
  // Auditoría ERP: busca configs con drift (deseada > aplicada) y las re-aplica.
  // Idempotente: aplicar la misma config dos veces es inocuo (el driver escribe
  // el mismo valor). El ConnectionRequest lo dispara el driver por cada write.
  //
  // Diseñado para correr en cron nocturno y también bajo demanda (endpoint).
  async reconcile(
    empresaId?: string,
  ): Promise<{ revisadas: number; conDrift: number; ok: number; fallidas: number;
               detalle: { contratoId: string; ok: boolean; mensaje: string }[] }> {
    const qb = this.configRepo.createQueryBuilder('c')
      .where('c.provisioning_enabled = true')
      .andWhere('c.deleted_at IS NULL')
      .andWhere('(c.last_applied_revision IS NULL OR c.last_applied_revision < c.revision)');
    if (empresaId) qb.andWhere('c.empresa_id = :empresaId', { empresaId });

    const conDrift = await qb.getMany();
    const detalle: { contratoId: string; ok: boolean; mensaje: string }[] = [];
    let ok = 0, fallidas = 0;

    for (const cfg of conDrift) {
      try {
        const r = await this.provisionContract(cfg.contratoId, cfg.empresaId);
        if (r.ok) ok++; else fallidas++;
        detalle.push({ contratoId: cfg.contratoId, ok: r.ok, mensaje: r.mensaje });
      } catch (e) {
        fallidas++;
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`reconcile: contrato ${cfg.contratoId} lanzó — ${msg}`);
        detalle.push({ contratoId: cfg.contratoId, ok: false, mensaje: msg });
      }
    }

    this.logger.log(
      `Reconcile${empresaId ? ` empresa=${empresaId}` : ''}: ` +
      `drift=${conDrift.length} ok=${ok} fallidas=${fallidas}`,
    );
    return { revisadas: conDrift.length, conDrift: conDrift.length, ok, fallidas, detalle };
  }
}
