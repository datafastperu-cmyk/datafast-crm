import { Injectable, Logger } from '@nestjs/common';
import { SmartoltApiService } from '../../smartolt/smartolt-api.service';
import {
  IOltProvider,
  OltConexion,
  OnuNoAprovisionada,
  OnuAprovisionadaResult,
  ProvisionarOnuPayload,
} from '../interfaces/olt-provider.interface';

interface CacheEntry {
  data: OnuNoAprovisionada[];
  ts:   number;
}

@Injectable()
export class SmartoltProvider implements IOltProvider {
  private readonly logger  = new Logger(SmartoltProvider.name);
  private readonly cache   = new Map<string, CacheEntry>();
  private readonly TTL_MS  = 30_000;

  constructor(private readonly smartoltApi: SmartoltApiService) {}

  async listarOnusNoAprovisionadas(olt: OltConexion): Promise<OnuNoAprovisionada[]> {
    const cached = this.cache.get(olt.externId);
    if (cached && Date.now() - cached.ts < this.TTL_MS) {
      this.logger.debug(`Cache hit ONUs no aprovisionadas | OLT=${olt.externId}`);
      return cached.data;
    }

    const raw = await this.smartoltApi.listarOnusNoAprovisionadas(olt.externId);
    const data: OnuNoAprovisionada[] = raw.map((o) => ({
      serial:      o.serial,
      ponPort:     o.pon_port,
      ponType:     o.pon_type,
      model:       o.model,
      detectedAt:  o.detected_at,
    }));

    this.cache.set(olt.externId, { data, ts: Date.now() });
    return data;
  }

  async aprovisionarOnu(
    olt: OltConexion,
    payload: ProvisionarOnuPayload,
  ): Promise<OnuAprovisionadaResult> {
    const onu = await this.smartoltApi.aprovisionarOnu({
      serial:      payload.serial,
      olt_id:      olt.externId,
      pon_port:    payload.ponPort,
      profile:     payload.perfil,
      vlan:        payload.vlanId,
      vlan_mode:   payload.vlanModo || 'access',
      description: payload.descripcion,
    });

    // Invalidar cache al aprovisionar
    this.cache.delete(olt.externId);

    return {
      externId: onu.id,
      serial:   onu.serial,
      ponPort:  onu.pon_port,
      estado:   onu.status,
    };
  }

  async desaprovisionarOnu(olt: OltConexion, onuExternId: string): Promise<void> {
    await this.smartoltApi.eliminarProvision(olt.externId, onuExternId);
    this.cache.delete(olt.externId);
  }

  async suspenderOnu(olt: OltConexion, onuExternId: string): Promise<void> {
    // SmartOLT no tiene endpoint directo de suspensión — se deshabilita vía perfil
    // El corte de ancho de banda se maneja en MikroTik (ya implementado en el orquestador)
    this.logger.warn(
      `suspenderOnu vía SmartOLT no aplica — el corte se hace en MikroTik. ` +
      `OLT=${olt.externId} ONU=${onuExternId}`,
    );
  }

  async reactivarOnu(olt: OltConexion, onuExternId: string): Promise<void> {
    this.logger.warn(
      `reactivarOnu vía SmartOLT no aplica — la reactivación se hace en MikroTik. ` +
      `OLT=${olt.externId} ONU=${onuExternId}`,
    );
  }

  invalidarCache(oltExternId: string): void {
    this.cache.delete(oltExternId);
  }
}
