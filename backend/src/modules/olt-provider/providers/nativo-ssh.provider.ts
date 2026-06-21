import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { OltAutomationClient } from '../../olt-nativo/olt-automation.client';
import {
  PythonConnectionPayload,
  PythonDeprovisionRequest,
} from '../../olt-nativo/dto/olt-nativo-ops.dto';
import {
  IOltProvider,
  OltConexion,
  OnuAprovisionadaResult,
  OnuNoAprovisionada,
  OnuVerificacionResult,
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

    // Formato: {ip}/{slot}/{port}/{onuId}/{servicePortId}
    // servicePortId puede ser undefined para OLTs no-Huawei
    const spId = payload.servicePortId ?? '';
    return {
      externId: `${olt.ipGestion}/${slot}/${port}/${onuId}/${spId}`,
      serial:   res.onu_sn,
      ponPort:  payload.ponPort,
      estado:   'aprovisionada',
    };
  }

  async desaprovisionarOnu(olt: OltConexion, onuExternId: string): Promise<void> {
    // Parsear externId: {ip}/{slot}/{port}/{onuId}/{servicePortId?}
    // El IP puede tener dots pero no slashes, por eso el split es seguro.
    const parts = onuExternId.split('/');
    if (parts.length < 4) {
      this.logger.warn(
        `desaprovisionarOnu: externId con formato inválido "${onuExternId}" — omitiendo`,
      );
      return;
    }

    const slot           = parseInt(parts[1] ?? '0', 10);
    const port           = parseInt(parts[2] ?? '0', 10);
    const onuId          = parseInt(parts[3] ?? '0', 10);
    const servicePortId  = parts[4] ? parseInt(parts[4], 10) : null;
    const rack           = 0;  // Rack por defecto; Huawei no usa rack, ZTE suele ser 0

    const reqPayload: PythonDeprovisionRequest = {
      connection: this.buildConnection(olt),
      onu: {
        slot,
        port,
        onu_id:          onuId,
        service_port_id: servicePortId,
        rack,
      },
    };

    const res = await this.oltClient.deprovision(reqPayload);
    if (!res.success) {
      throw new ServiceUnavailableException(
        `Desaprovisionamiento SSH falló en OLT ${olt.ipGestion}: ${res.message}`,
      );
    }

    this.logger.log(
      `ONU desaprovisionada vía SSH | OLT=${olt.ipGestion} | externId=${onuExternId}`,
    );
  }

  async verificarOnu(
    olt: OltConexion,
    slot: number,
    port: number,
    onuId: number,
  ): Promise<OnuVerificacionResult> {
    const res = await this.oltClient.verifyOnu({
      connection: this.buildConnection(olt),
      slot,
      port,
      onu_id: onuId,
    });

    return {
      online:       res.success && res.run_state === 'online',
      runState:     res.run_state ?? null,
      rxPowerDbm:   res.rx_power_dbm ?? null,
      txPowerDbm:   res.tx_power_dbm ?? null,
      temperatureC: res.temperature_c ?? null,
      error:        res.error,
    };
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
