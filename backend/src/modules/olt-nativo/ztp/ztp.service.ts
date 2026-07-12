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

    // Modo WAN de la ONU (bridge → el PPPoE lo hace el router del cliente, no la ONU).
    const [reg] = await this.ds.query<{ wan_mode: string | null }[]>(
      `SELECT wan_mode FROM ftth_onu_registro WHERE contrato_id = $1 AND empresa_id = $2`,
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
      voip: cfg.voipEnabled && !!cfg.voipUser
        ? { enabled: true, user: cfg.voipUser, password: this._dec(cfg.voipPassword) }
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
}
