import { resolve } from './resolver';
import { HUAWEI_EG8145V5 } from './device-profiles/huawei-eg8145v5';
import { HUAWEI_IGD_V1 } from './parameter-maps/huawei-igd-v1';
import { DesiredConfiguration } from './ztp.contracts';

const desired = (over: Partial<DesiredConfiguration> = {}): DesiredConfiguration => ({
  schemaVersion: 1,
  metadata: { revision: 7, generated_at: 'x', generated_by: 'ERP' },
  wifi:     { enabled: true, ssid: 'S', password: 'P' },
  internet: { enabled: true, type: 'pppoe', username: 'u', password: 'p' },
  voip:     { enabled: false },
  ...over,
});

describe('resolve (Resolver)', () => {
  it('produce writes con las rutas del parameter_map y el valor de negocio', () => {
    const plan = resolve('dev', desired(), HUAWEI_EG8145V5, HUAWEI_IGD_V1);
    const keys = plan.writes.map((w) => w.key);
    expect(keys).toEqual(expect.arrayContaining(['wifi.enable', 'wifi.ssid', 'wifi.password', 'internet.username', 'internet.password']));
    const ssid = plan.writes.find((w) => w.key === 'wifi.ssid');
    expect(ssid?.candidates[0]).toContain('WLANConfiguration.1.SSID');
    expect(ssid?.value).toBe('S');
  });

  it('wifi.password lleva priority-list (fallback) — PreSharedKey primero', () => {
    const pw = resolve('dev', desired(), HUAWEI_EG8145V5, HUAWEI_IGD_V1).writes.find((w) => w.key === 'wifi.password');
    expect(pw!.candidates.length).toBeGreaterThan(1);
    expect(pw!.candidates[0]).toContain('PreSharedKey.1.KeyPassphrase');
  });

  it('internet.username conserva el placeholder {ppp} para runtime', () => {
    const u = resolve('dev', desired(), HUAWEI_EG8145V5, HUAWEI_IGD_V1).writes.find((w) => w.key === 'internet.username');
    expect(u?.candidates[0]).toContain('{ppp}');
  });

  it('internet bridge: no genera writes de PPPoE', () => {
    const plan = resolve('dev', desired({ internet: { enabled: true, type: 'bridge' } }), HUAWEI_EG8145V5, HUAWEI_IGD_V1);
    expect(plan.writes.find((w) => w.key === 'internet.username')).toBeUndefined();
  });

  it('wifi deshabilitado: no genera writes de WiFi', () => {
    const plan = resolve('dev', desired({ wifi: { enabled: false, ssid: '', password: '' } }), HUAWEI_EG8145V5, HUAWEI_IGD_V1);
    expect(plan.writes.some((w) => w.key.startsWith('wifi'))).toBe(false);
  });

  it('onuAdmin: emite writes de credenciales admin de la ONU con la ruta X_HW_WebUserInfo.2', () => {
    const plan = resolve('dev', desired({ onuAdmin: { enabled: true, user: 'soporte', password: 'S3creta#9' } }),
      HUAWEI_EG8145V5, HUAWEI_IGD_V1);
    const u = plan.writes.find((w) => w.key === 'onu_admin.user');
    const p = plan.writes.find((w) => w.key === 'onu_admin.password');
    expect(u?.candidates[0]).toContain('X_HW_WebUserInfo.2.UserName');
    expect(u?.value).toBe('soporte');
    expect(p?.candidates[0]).toContain('X_HW_WebUserInfo.2.Password');
    expect(p?.value).toBe('S3creta#9');
  });

  it('onuAdmin: cuentas usuario web (.1) y CLI root (Eproot) con sus rutas', () => {
    const plan = resolve('dev', desired({ onuAdmin: {
      enabled: true, webUser: 'cliente', webUserPassword: 'Web#1234', cliUser: 'root', cliPassword: 'Cli#1234',
    } }), HUAWEI_EG8145V5, HUAWEI_IGD_V1);
    expect(plan.writes.find((w) => w.key === 'onu_webuser.user')?.candidates[0]).toContain('X_HW_WebUserInfo.1.UserName');
    expect(plan.writes.find((w) => w.key === 'onu_webuser.password')?.value).toBe('Web#1234');
    expect(plan.writes.find((w) => w.key === 'onu_cli.user')?.candidates[0]).toContain('X_HW_CLIUserInfo.1.Username');
    expect(plan.writes.find((w) => w.key === 'onu_cli.password')?.candidates[0]).toContain('X_HW_CLIUserInfo.1.Userpassword');
  });

  it('onuAdmin: solo emite las cuentas con valor (las vacías se omiten)', () => {
    const plan = resolve('dev', desired({ onuAdmin: { enabled: true, user: 'a', password: 'Admin#12' } }),
      HUAWEI_EG8145V5, HUAWEI_IGD_V1);
    expect(plan.writes.some((w) => w.key.startsWith('onu_webuser'))).toBe(false);
    expect(plan.writes.some((w) => w.key.startsWith('onu_cli'))).toBe(false);
  });

  it('onuAdmin deshabilitado: no genera writes de credenciales admin', () => {
    const plan = resolve('dev', desired({ onuAdmin: { enabled: false } }), HUAWEI_EG8145V5, HUAWEI_IGD_V1);
    expect(plan.writes.some((w) => w.key.startsWith('onu_admin'))).toBe(false);
  });

  it('management: emite credenciales CWMP (ManagementServer.Username/Password)', () => {
    const plan = resolve('dev', desired({ management: { acsUsername: 'soltcpe', acsPassword: 'kzDHqd35fPlt' } }),
      HUAWEI_EG8145V5, HUAWEI_IGD_V1);
    const u = plan.writes.find((w) => w.key === 'management.username');
    const p = plan.writes.find((w) => w.key === 'management.password');
    expect(u?.candidates[0]).toBe('InternetGatewayDevice.ManagementServer.Username');
    expect(u?.value).toBe('soltcpe');
    expect(p?.value).toBe('kzDHqd35fPlt');
  });

  it('sin management: no genera writes de credenciales CWMP', () => {
    const plan = resolve('dev', desired(), HUAWEI_EG8145V5, HUAWEI_IGD_V1);
    expect(plan.writes.some((w) => w.key.startsWith('management'))).toBe(false);
  });

  it('propaga device, profile y metadata.revision', () => {
    const plan = resolve('dev-99', desired(), HUAWEI_EG8145V5, HUAWEI_IGD_V1);
    expect(plan.device).toBe('dev-99');
    expect(plan.profile).toBe('Huawei_EG8145V5');
    expect(plan.metadata.revision).toBe(7);
  });
});
