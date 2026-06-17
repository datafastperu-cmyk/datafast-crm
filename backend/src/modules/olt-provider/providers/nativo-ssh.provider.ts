import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { OltAutomationClient } from '../../olt-nativo/olt-automation.client';
import { PythonConnectionPayload } from '../../olt-nativo/dto/olt-nativo-ops.dto';
import {
  IOltProvider,
  OltConexion,
  OnuNoAprovisionada,
  OnuAprovisionadaResult,
  ProvisionarOnuPayload,
} from '../interfaces/olt-provider.interface';

@Injectable()
export class NativoSshProvider implements IOltProvider {
  private readonly logger = new Logger(NativoSshProvider.name);

  constructor(private readonly oltClient: OltAutomationClient) {}

  private buildConnection(olt: OltConexion): PythonConnectionPayload {
    if (!olt.ipGestion || !olt.usuario || !olt.contrasenaCifrada) {
      throw new ServiceUnavailableException(
        `OLT ${olt.externId} sin ip_gestion, usuario o contraseña para SSH nativo.`,
      );
    }
    return {
      ip:       olt.ipGestion,
      port:     olt.puerto ?? 23,
      username: olt.usuario,
      password: olt.contrasenaCifrada,
      brand:    (olt.marca ?? 'huawei').toLowerCase(),
    };
  }

  async listarOnusNoAprovisionadas(olt: OltConexion): Promise<OnuNoAprovisionada[]> {
    const res = await this.oltClient.discoverOnus({
      connection: this.buildConnection(olt),
      slot:       null,
      port:       null,
    });

    if (!res.success) {
      throw new ServiceUnavailableException(
        `discoverOnus falló en OLT ${olt.ipGestion}: ${res.error}`,
      );
    }

    return res.onus.map((o) => ({
      serial:  o.sn,
      ponPort: `${o.slot}/${o.port}`,
    }));
  }

  async aprovisionarOnu(
    olt: OltConexion,
    payload: ProvisionarOnuPayload,
  ): Promise<OnuAprovisionadaResult> {
    const parts  = payload.ponPort.split('/');
    const slot   = payload.ponSlot   ?? parseInt(parts[0] ?? '0', 10);
    const port   = payload.ponPortNum ?? parseInt(parts[parts.length - 1] ?? '0', 10);
    const onuId  = payload.onuId ?? 1;

    const res = await this.oltClient.provision({
      connection: this.buildConnection(olt),
      onu: {
        frame:          payload.frame        ?? 0,
        slot,
        port,
        onu_id:         onuId,
        sn:             payload.serial,
        vlan:           payload.vlanId,
        vlan_gestion:   payload.vlanGestion  ?? payload.vlanId,
        profile_speed:  payload.perfil,
        service_port_id: payload.servicePortId,
        traffic_index:   payload.trafficIndex,
        onu_type:        payload.onuType,
      },
    });

    if (!res.success) {
      throw new ServiceUnavailableException(
        `Aprovisionamiento SSH falló en OLT ${olt.ipGestion}: ${res.message}`,
      );
    }

    this.logger.log(
      `ONU aprovisionada vía SSH | OLT=${olt.ipGestion} | SN=${res.onu_sn} | slot=${slot} port=${port}`,
    );

    return {
      externId: `${olt.ipGestion}/${slot}/${port}/${onuId}`,
      serial:   res.onu_sn,
      ponPort:  payload.ponPort,
      estado:   'aprovisionada',
    };
  }

  async desaprovisionarOnu(olt: OltConexion, onuExternId: string): Promise<void> {
    // El microservicio Python no implementa desaprovisionamiento SSH todavía.
    // Se registra como warning para tracking manual.
    this.logger.warn(
      `desaprovisionarOnu SSH no implementado — OLT=${olt.ipGestion} ONU=${onuExternId}. ` +
      `Requiere desconfiguración manual en la OLT.`,
    );
  }

  async suspenderOnu(olt: OltConexion, onuExternId: string): Promise<void> {
    this.logger.warn(
      `suspenderOnu SSH — el corte se hace en MikroTik. OLT=${olt.ipGestion} ONU=${onuExternId}`,
    );
  }

  async reactivarOnu(olt: OltConexion, onuExternId: string): Promise<void> {
    this.logger.warn(
      `reactivarOnu SSH — la reactivación se hace en MikroTik. OLT=${olt.ipGestion} ONU=${onuExternId}`,
    );
  }
}
