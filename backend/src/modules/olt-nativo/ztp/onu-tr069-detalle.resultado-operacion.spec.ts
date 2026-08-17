import { OnuTr069DetalleService } from './onu-tr069-detalle.service';

jest.mock('./registry', () => ({
  matchDeviceProfile: jest.fn(),
  getParameterMap: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const registry = require('./registry');

// Ola 1, grupo 4 (2026-08-17, cierre de la ola) — refrescarWifi()/setWifi()/
// setWifiAmbasBandas() hablan ResultadoOperacion. Único consumidor cruzando módulo:
// PortalOnuService — el primer borde de esta ola que da a un cliente final, no a un
// operador ni al outbox (setWifi también lo consume olt-nativo.controller.ts, mismo módulo).
//
// clasificarErrorTr069() (PA-03) es el único sitio que decide: "ONU no informando"/"NBI no
// configurado"/"sin device-profile" son transitorios → reintentable (D-14: ante la duda,
// reintentable); "parameter_map no registrado" es un hueco de configuración → rechazado_definitivo.
describe('OnuTr069DetalleService — clasificación por rama', () => {
  const hacer = (over: Record<string, unknown> = {}) => {
    const svc = Object.create(OnuTr069DetalleService.prototype) as any;
    svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    svc.nbi = {
      isConfigured: jest.fn(() => true),
      getDevice: jest.fn(async () => ({})),
      listTasks: jest.fn(async () => []),
      deleteTask: jest.fn(async () => {}),
      queueTask: jest.fn(async () => ({ status: 200 })),
    };
    svc.driver = {
      findDeviceIdBySerial: jest.fn(async () => 'dev-1'),
      getRuntime: jest.fn(async () => ({ manufacturer: 'Huawei', modelName: 'EG8145V5' })),
      applyExecutionPlan: jest.fn(async () => ({ applied: 1 })),
    };
    svc.onuConfig = { markPendingReinjectionBySerial: jest.fn(async () => {}) };
    Object.assign(svc, over);
    return svc;
  };

  describe('refrescarWifi()', () => {
    it('aplicado: refresco encolado y la ONU respondió con datos frescos', async () => {
      const svc = hacer({
        nbi: {
          isConfigured: jest.fn(() => true),
          listTasks: jest.fn(async () => []),
          deleteTask: jest.fn(async () => {}),
          queueTask: jest.fn(async () => ({ status: 200 })),
          getDevice: jest.fn(async () => ({
            _lastInform: new Date().toISOString(),
            _deviceId: {}, InternetGatewayDevice: {},
          })),
        },
      });
      const r = await svc.refrescarWifi('SN1');
      expect(r.clase).toBe('aplicado');
      expect(r.detalle.informing).toBe(true);
    });

    // Trampa del portal (condición del propietario, cierre grupo 4): la ONU no respondió al
    // refresco a tiempo — no es un fallo, es D-14 §2 (pudo haberse aplicado, no se sabe).
    it('indeterminado: la ONU no respondió al refresco — no es reintentable ni rechazo', async () => {
      const svc = hacer({
        nbi: {
          isConfigured: jest.fn(() => true),
          listTasks: jest.fn(async () => []),
          deleteTask: jest.fn(async () => {}),
          queueTask: jest.fn(async () => ({ status: 200 })),
          getDevice: jest.fn(async () => null),
        },
        driver: { findDeviceIdBySerial: jest.fn(async () => 'dev-1') },
      });
      const r = await svc.refrescarWifi('SN1');
      expect(r.clase).toBe('indeterminado');
    });

    it('reintentable: la ONU nunca informó a GenieACS — transitorio, puede volver a informar', async () => {
      const svc = hacer({
        driver: { findDeviceIdBySerial: jest.fn(async () => null) },
      });
      const r = await svc.refrescarWifi('SN1');
      expect(r.clase).toBe('reintentable');
    });

    it('reintentable: NBI no configurado — módulo degradado, no un rechazo permanente', async () => {
      const svc = hacer({ nbi: { isConfigured: jest.fn(() => false) } });
      const r = await svc.refrescarWifi('SN1');
      expect(r.clase).toBe('reintentable');
    });
  });

  describe('setWifi()', () => {
    beforeEach(() => {
      registry.matchDeviceProfile.mockReset();
      registry.getParameterMap.mockReset();
    });

    it('aplicado: cambio despachado al equipo', async () => {
      registry.matchDeviceProfile.mockReturnValue({ vendor: 'Huawei', model: 'EG8145V5', parameter_map: 'huawei_v5' });
      registry.getParameterMap.mockReturnValue({ map: { 'wifi.ssid': ['X'], 'wifi.password': ['Y'], 'wifi.enable': ['Z'] } });
      const svc = hacer();
      const r = await svc.setWifi('SN1', { band: '2.4', ssid: 'RED-NUEVA' });
      expect(r.clase).toBe('aplicado');
      expect(r.applied).toBeGreaterThan(0);
    });

    it('no_aplica: dto sin campos con valor — nada que escribir', async () => {
      registry.matchDeviceProfile.mockReturnValue({ vendor: 'Huawei', model: 'EG8145V5', parameter_map: 'huawei_v5' });
      registry.getParameterMap.mockReturnValue({ map: { 'wifi.ssid': ['X'] } });
      const svc = hacer();
      const r = await svc.setWifi('SN1', { band: '2.4' });
      expect(r.clase).toBe('no_aplica');
    });

    it('reintentable: sin device-profile para el modelo — ante la duda, reintentable', async () => {
      registry.matchDeviceProfile.mockReturnValue(null);
      const svc = hacer();
      const r = await svc.setWifi('SN1', { band: '2.4', ssid: 'X' });
      expect(r.clase).toBe('reintentable');
    });

    it('rechazado_definitivo: parameter_map no registrado — hueco de configuración, no se arregla reintentando', async () => {
      registry.matchDeviceProfile.mockReturnValue({ vendor: 'Huawei', model: 'EG8145V5', parameter_map: 'sin_registrar' });
      registry.getParameterMap.mockReturnValue(null);
      const svc = hacer();
      const r = await svc.setWifi('SN1', { band: '2.4', ssid: 'X' });
      expect(r.clase).toBe('rechazado_definitivo');
    });

    it('reintentable: la ONU no está informando a GenieACS', async () => {
      const svc = hacer({ driver: { findDeviceIdBySerial: jest.fn(async () => null) } });
      const r = await svc.setWifi('SN1', { band: '2.4', ssid: 'X' });
      expect(r.clase).toBe('reintentable');
    });

    it('el error inesperado no lanza: cae en clasificarError vía clasificarErrorTr069', async () => {
      registry.matchDeviceProfile.mockImplementation(() => { throw new Error('boom'); });
      const svc = hacer();
      await expect(svc.setWifi('SN1', { band: '2.4', ssid: 'X' })).resolves.toHaveProperty('clase');
    });
  });

  describe('setWifiAmbasBandas()', () => {
    beforeEach(() => {
      registry.matchDeviceProfile.mockReset();
      registry.getParameterMap.mockReset();
    });

    it('aplicado: una sola escritura para las dos bandas', async () => {
      registry.matchDeviceProfile.mockReturnValue({ vendor: 'Huawei', model: 'EG8145V5', parameter_map: 'huawei_v5' });
      registry.getParameterMap.mockReturnValue({
        map: { 'wifi.ssid': ['X'], 'wifi.password': ['Y'], 'wifi5g.ssid': ['X5'], 'wifi5g.password': ['Y5'] },
      });
      const svc = hacer();
      const r = await svc.setWifiAmbasBandas('SN1', { ssid: 'RED-UNIFICADA' });
      expect(r.clase).toBe('aplicado');
      expect(r.applied).toBe(2); // ssid en las dos bandas, sin clave
    });

    it('rechazado_definitivo: parameter_map no registrado', async () => {
      registry.matchDeviceProfile.mockReturnValue({ vendor: 'Huawei', model: 'EG8145V5', parameter_map: 'sin_registrar' });
      registry.getParameterMap.mockReturnValue(null);
      const svc = hacer();
      const r = await svc.setWifiAmbasBandas('SN1', { ssid: 'X' });
      expect(r.clase).toBe('rechazado_definitivo');
    });
  });
});
