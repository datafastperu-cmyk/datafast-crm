import { DeviceProfile } from '../ztp.contracts';

export const HUAWEI_EG8145V5: DeviceProfile = {
  vendor: 'Huawei',
  model: 'EG8145V5',
  firmware: 'V5R020C10S195',
  // GenieACS reporta ProductClass (identificador canónico) en _deviceId; NO trae ModelName
  // ahí y el Manufacturer varía en formato. Casamos por ProductClass → todos los firmwares
  // del EG8145V5 usan este mismo perfil/map (el firmware solo es informativo).
  match: {
    productClass: 'EG8145V5',
  },
  bootstrap_method: 'DHCP_OPTION_43',
  parameter_map: 'huawei_igd_v1',
  provision: 'default_internet',
  capabilities: {
    pppoe: true,
    wifi_2g: true,
    wifi_5g: true,
    vlan_per_service: true,
    voip: true,
    iptv_multicast: true,
    // Rutas X_HW_WebUserInfo/X_HW_CLIUserInfo verificadas writable en vivo (2026-07-12).
    onu_admin_credentials: true,
  },
};
