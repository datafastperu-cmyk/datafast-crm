import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  IOltProvider,
  OltConexion,
  OnuNoAprovisionada,
  OnuAprovisionadaResult,
  ProvisionarOnuPayload,
} from '../interfaces/olt-provider.interface';

// SNMP es solo lectura — no soporta aprovisionamiento ni comandos de escritura.
@Injectable()
export class NativoSnmpProvider implements IOltProvider {
  private readonly logger = new Logger(NativoSnmpProvider.name);

  async listarOnusNoAprovisionadas(_olt: OltConexion): Promise<OnuNoAprovisionada[]> {
    throw new ServiceUnavailableException(
      'SNMP es solo lectura. El descubrimiento de ONUs no aprovisionadas ' +
      'no está disponible para OLTs con método NATIVO_SNMP. ' +
      'Cambia el método a NATIVO_SSH o SMARTOLT_API.',
    );
  }

  async aprovisionarOnu(
    _olt: OltConexion,
    _payload: ProvisionarOnuPayload,
  ): Promise<OnuAprovisionadaResult> {
    throw new ServiceUnavailableException(
      'SNMP es solo lectura. El aprovisionamiento no está disponible ' +
      'para OLTs con método NATIVO_SNMP.',
    );
  }

  async desaprovisionarOnu(_olt: OltConexion, _onuExternId: string): Promise<void> {
    throw new ServiceUnavailableException(
      'SNMP es solo lectura. El desaprovisionamiento no está disponible ' +
      'para OLTs con método NATIVO_SNMP.',
    );
  }

  async suspenderOnu(olt: OltConexion, onuExternId: string): Promise<void> {
    this.logger.warn(
      `suspenderOnu SNMP — el corte se hace en MikroTik. OLT=${olt.externId} ONU=${onuExternId}`,
    );
  }

  async reactivarOnu(olt: OltConexion, onuExternId: string): Promise<void> {
    this.logger.warn(
      `reactivarOnu SNMP — la reactivación se hace en MikroTik. OLT=${olt.externId} ONU=${onuExternId}`,
    );
  }
}
