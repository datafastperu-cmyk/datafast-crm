// Cifrado mockeado (evita depender de ENCRYPTION_KEY en el entorno de test).
jest.mock('../../../common/utils/encryption.util', () => ({
  encrypt: (s: string) => `enc(${s})`,
  decrypt: (s: string) => s,
}));

import { ContratoOnuConfigService } from './contrato-onu-config.service';

describe('ContratoOnuConfigService', () => {
  let repo: any;
  let svc: ContratoOnuConfigService;

  beforeEach(() => {
    repo = {
      findOne: jest.fn(),
      create:  jest.fn((o: any) => ({ ...o })),
      save:    jest.fn((o: any) => Promise.resolve(o)),
    };
    svc = new ContratoOnuConfigService(repo);
  });

  describe('generateWifi', () => {
    it('genera SSID DATAFAST-<4hex> + clave fuerte con complejidad y trazabilidad', async () => {
      repo.findOne.mockResolvedValue(null);
      const { ssid, password } = await svc.generateWifi('11111111-2222-3333-4444-555566667777', 'emp');

      expect(ssid).toBe('DATAFAST-7777');
      expect(password).toHaveLength(12);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[#$%&*+]/);
      expect(password).not.toMatch(/[IO01l]/); // sin ambiguos

      const saved = repo.save.mock.calls[0][0];
      expect(saved.wifiPasswordGenerated).toBe(true);
      expect(saved.lastGeneratedAt).toBeInstanceOf(Date);
      expect(saved.wifiPassword).toBe(`enc(${password})`);
      expect(saved.revision).toBe(1);
    });

    it('genera claves distintas en llamadas sucesivas', async () => {
      repo.findOne.mockResolvedValue(null);
      const a = await svc.generateWifi('c1', 'emp');
      const b = await svc.generateWifi('c1', 'emp');
      expect(a.password).not.toBe(b.password);
    });
  });

  describe('upsert', () => {
    it('clave WiFi manual → wifi_password_generated=false y revision sube', async () => {
      repo.findOne.mockResolvedValue({ revision: 3, wifiPasswordGenerated: true });
      const saved = await svc.upsert('c1', 'emp', { wifiPassword: 'MiClave#2026' });
      expect(saved.wifiPassword).toBe('enc(MiClave#2026)');
      expect(saved.wifiPasswordGenerated).toBe(false);
      expect(saved.lastGeneratedAt).toBeNull();
      expect(saved.revision).toBe(4);
    });

    it('cifra la clave VoIP', async () => {
      repo.findOne.mockResolvedValue({ revision: 0 });
      const saved = await svc.upsert('c1', 'emp', { voipEnabled: true, voipPassword: 'sip123' });
      expect(saved.voipPassword).toBe('enc(sip123)');
      expect(saved.voipEnabled).toBe(true);
    });
  });

  describe('setProvisioningEnabled', () => {
    it('lanza si no existe la config', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(svc.setProvisioningEnabled('c1', 'emp', true)).rejects.toThrow();
    });
    it('activa el flag', async () => {
      repo.findOne.mockResolvedValue({ provisioningEnabled: false });
      const saved = await svc.setProvisioningEnabled('c1', 'emp', true);
      expect(saved.provisioningEnabled).toBe(true);
    });
  });
});
