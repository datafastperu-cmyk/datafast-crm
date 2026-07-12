import { filterByCapabilities } from './capability.engine';
import { DesiredConfiguration, DeviceProfile } from './ztp.contracts';

const baseDesired = (): DesiredConfiguration => ({
  schemaVersion: 1,
  metadata: { revision: 1, generated_at: 'x', generated_by: 'ERP' },
  wifi:     { enabled: true, ssid: 'S', password: 'P', ssid5g: 'S5', password5g: 'P5' },
  internet: { enabled: true, type: 'pppoe', username: 'u', password: 'p' },
  voip:     { enabled: true, user: 'vu', password: 'vp' },
  onuAdmin: { enabled: true, user: 'admin', password: 'AdminPwd#1' },
});

const profile = (caps: Partial<DeviceProfile['capabilities']>): DeviceProfile => ({
  vendor: 'V', model: 'M', match: { productClass: 'M' }, bootstrap_method: 'DHCP_OPTION_43',
  parameter_map: 'm', provision: 'p',
  capabilities: { pppoe: true, wifi_2g: true, wifi_5g: true, voip: true, onu_admin_credentials: true, ...caps },
});

describe('filterByCapabilities', () => {
  it('modelo completo: mantiene todos los servicios', () => {
    const out = filterByCapabilities(baseDesired(), profile({}));
    expect(out.wifi?.enabled).toBe(true);
    expect(out.wifi?.ssid5g).toBe('S5');
    expect(out.internet?.enabled).toBe(true);
    expect(out.voip?.enabled).toBe(true);
  });

  it('sin wifi_5g: retira la banda de 5G', () => {
    const out = filterByCapabilities(baseDesired(), profile({ wifi_5g: false }));
    expect(out.wifi?.ssid5g).toBeUndefined();
    expect(out.wifi?.password5g).toBeUndefined();
    expect(out.wifi?.enabled).toBe(true); // 2.4G intacto
  });

  it('sin wifi_2g: deshabilita WiFi', () => {
    const out = filterByCapabilities(baseDesired(), profile({ wifi_2g: false }));
    expect(out.wifi?.enabled).toBe(false);
  });

  it('sin voip: deshabilita VoIP', () => {
    const out = filterByCapabilities(baseDesired(), profile({ voip: false }));
    expect(out.voip?.enabled).toBe(false);
  });

  it('sin pppoe: deshabilita internet PPPoE', () => {
    const out = filterByCapabilities(baseDesired(), profile({ pppoe: false }));
    expect(out.internet?.enabled).toBe(false);
  });

  it('modelo completo: mantiene credenciales admin de la ONU', () => {
    const out = filterByCapabilities(baseDesired(), profile({}));
    expect(out.onuAdmin?.enabled).toBe(true);
  });

  it('sin onu_admin_credentials: deshabilita la gestión de credenciales admin', () => {
    const out = filterByCapabilities(baseDesired(), profile({ onu_admin_credentials: false }));
    expect(out.onuAdmin?.enabled).toBe(false);
  });

  it('no muta la configuración de entrada (inmutable)', () => {
    const d = baseDesired();
    filterByCapabilities(d, profile({ wifi_5g: false, voip: false }));
    expect(d.wifi?.ssid5g).toBe('S5');
    expect(d.voip?.enabled).toBe(true);
  });
});
