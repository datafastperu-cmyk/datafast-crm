import { Injectable, Logger } from '@nestjs/common';
import { OltAutomationClient } from '../../olt-automation.client';
import {
  BootstrapContext, ChannelResult, CpeProvisioningChannel, DeviceProfile,
} from './cpe-provisioning-channel.interface';

// Estrategia `dhcp_bootstrap` — la ONU descubre la ACS URL por DHCP (Option 43 en Huawei;
// Option 125 u otro Vendor-Specific en otros fabricantes). El canal solo prepara el plano
// de gestión de la OLT en modo DHCP (WAN mgmt DHCP + service-port GEM3); la URL la sirve el
// gateway DHCP de la VLAN de gestión (MikroTik). Reutiliza el MISMO provision_mgmt_bootstrap
// que el canal OMCI, parametrizado con modo='dhcp'. Su "success" NUNCA se interpreta como
// convergencia — el resolver la verifica contra GenieACS (VIO). Validado en EG8145V5/V5R020C10S195.
@Injectable()
export class HuaweiDhcpBootstrapChannel implements CpeProvisioningChannel {
  readonly nombre = 'dhcp_bootstrap' as const;
  private readonly logger = new Logger(HuaweiDhcpBootstrapChannel.name);

  constructor(private readonly automation: OltAutomationClient) {}

  supports(device: DeviceProfile): boolean {
    return device.fabricante.toLowerCase() === 'huawei';
  }

  async bootstrap(ctx: BootstrapContext): Promise<ChannelResult> {
    if (!ctx.omci) {
      return { exitoso: false, mensaje: 'Contexto de red incompleto para el carril de gestión', error: 'omci_context_missing' };
    }
    const { omci } = ctx;
    try {
      const res = await this.automation.ftthBootstrapTr069({
        connection:           omci.connection,
        slot:                 omci.slot,
        port:                 omci.port,
        onu_id:               omci.onuId,
        mgmt_vlan:            omci.mgmtVlan,
        mgmt_service_port_id: omci.mgmtServicePortId,
        mgmt_ip:              ctx.device.mgmtIp,   // ignorado en modo dhcp (la IP la da el DHCP)
        mgmt_mask:            omci.mgmtMask,
        mgmt_gateway:         omci.mgmtGateway,
        acs_url:              ctx.acsUrl,
        traffic_index:        omci.trafficIndex,
        priority:             omci.priority,
        modo:                 'dhcp',
      });
      if (!res.success) {
        return { exitoso: false, mensaje: 'La OLT rechazó el carril DHCP de gestión', error: res.error };
      }
      return { exitoso: true, mensaje: 'Carril DHCP de gestión aplicado (URL por Option 43, pendiente de verificación real)' };
    } catch (err: any) {
      this.logger.warn(`Canal dhcp_bootstrap falló | registro=${ctx.ftthRegistroId}: ${err?.message}`);
      return { exitoso: false, mensaje: 'Error de comunicación con la OLT', error: err?.message ?? String(err) };
    }
  }
}
