import { Injectable, Logger } from '@nestjs/common';
import { OltAutomationClient } from '../../olt-automation.client';
import {
  BootstrapContext, ChannelResult, CpeProvisioningChannel, DeviceProfile,
} from './cpe-provisioning-channel.interface';

// Canal estándar — reutiliza el endpoint Python ya existente
// (provision_mgmt_bootstrap: WAN tr069 + service-port + bind a
// tr069-server-profile). Es el primer canal que el resolver siempre intenta,
// por ser el que además resuelve GEM/T-CONT/WAN — pero su "success" NUNCA
// se interpreta como convergencia real (ver ProvisioningStrategyResolver).
@Injectable()
export class HuaweiOmciBootstrapChannel implements CpeProvisioningChannel {
  readonly nombre = 'omci_tr069' as const;
  private readonly logger = new Logger(HuaweiOmciBootstrapChannel.name);

  constructor(private readonly automation: OltAutomationClient) {}

  supports(device: DeviceProfile): boolean {
    return device.fabricante.toLowerCase() === 'huawei';
  }

  async bootstrap(ctx: BootstrapContext): Promise<ChannelResult> {
    if (!ctx.omci) {
      return { exitoso: false, mensaje: 'Contexto OMCI incompleto', error: 'omci_context_missing' };
    }
    const { omci } = ctx;
    try {
      const res = await this.automation.ftthBootstrapTr069({
        connection:            omci.connection,
        slot:                  omci.slot,
        port:                  omci.port,
        onu_id:                omci.onuId,
        mgmt_vlan:             omci.mgmtVlan,
        mgmt_service_port_id:  omci.mgmtServicePortId,
        mgmt_ip:               ctx.device.mgmtIp,
        mgmt_mask:             omci.mgmtMask,
        mgmt_gateway:          omci.mgmtGateway,
        acs_url:               ctx.acsUrl,
        traffic_index:         omci.trafficIndex,
        priority:              omci.priority,
      });
      if (!res.success) {
        return { exitoso: false, mensaje: 'OMCI rechazó el bootstrap TR-069', error: res.error };
      }
      return { exitoso: true, mensaje: 'OMCI aceptó el bootstrap TR-069 (pendiente de verificación real)' };
    } catch (err: any) {
      this.logger.warn(`Canal omci_tr069 falló | registro=${ctx.ftthRegistroId}: ${err?.message}`);
      return { exitoso: false, mensaje: 'Error de comunicación OMCI', error: err?.message ?? String(err) };
    }
  }
}
