import { WirelessService } from './wireless.service';

// Ola 1, grupo 3b (2026-08-16) — conversión de las 2 operaciones de Access List inalámbrica,
// consumidas por ContratosService (registrarEnAccessListAntena/eliminarDeAccessListAntena,
// ambos con su propio try/catch) y MonitoreoService.repararAntenaAP() (bucle con try/catch
// por contrato) — los tres llamadores ya traducían la excepción a su propio contrato.
describe('WirelessService.agregarMacAccessList() — clasificación por rama', () => {
  const creds = { id: 'ap-1', ip: '10.0.0.1', port: 8728, user: 'admin', passwordCifrado: '', useSsl: false, timeoutSec: 10, version: 'v6' } as any;

  const hacer = (over: Record<string, unknown> = {}) => {
    const svc = Object.create(WirelessService.prototype) as any;
    svc.pool = { execute: jest.fn(async (_creds: any, fn: any) => fn({ write: jest.fn(async () => []) })) };
    Object.assign(svc, over);
    return svc;
  };

  it('aplicado: MAC registrada en la Access List', async () => {
    const svc = hacer();
    const r = await svc.agregarMacAccessList(creds, 'aa:bb:cc:dd:ee:ff', 'DATAFAST:Juan');
    expect(r.clase).toBe('aplicado');
  });

  it('el error inesperado no lanza: cae en clasificarError vía el catch', async () => {
    const svc = hacer({ pool: { execute: jest.fn(async () => { throw new Error('No se pudo conectar al router'); }) } });
    const r = await svc.agregarMacAccessList(creds, 'aa:bb:cc:dd:ee:ff', 'DATAFAST:Juan');
    expect(r.clase).toBe('reintentable');
  });
});

describe('WirelessService.eliminarMacAccessList() — clasificación por rama', () => {
  const creds = { id: 'ap-1', ip: '10.0.0.1', port: 8728, user: 'admin', passwordCifrado: '', useSsl: false, timeoutSec: 10, version: 'v6' } as any;

  const hacer = (entries: any[]) => {
    const svc = Object.create(WirelessService.prototype) as any;
    svc.pool = { execute: jest.fn(async (_creds: any, fn: any) => fn({ write: jest.fn(async () => entries) })) };
    return svc;
  };

  it('aplicado: se removió al menos una entrada', async () => {
    const svc = hacer([{ '.id': '*1' }]);
    const r = await svc.eliminarMacAccessList(creds, 'aa:bb:cc:dd:ee:ff');
    expect(r.clase).toBe('aplicado');
  });

  // El caso que motivó la conversión: "removed === 0" antes se leía como advertencia de
  // "no encontrada" — es exactamente ya_en_destino (nada que remover, destino ya alcanzado).
  it('ya_en_destino: la MAC no estaba en la Access List', async () => {
    const svc = hacer([]);
    const r = await svc.eliminarMacAccessList(creds, 'aa:bb:cc:dd:ee:ff');
    expect(r.clase).toBe('ya_en_destino');
  });

  it('el error inesperado no lanza: cae en clasificarError vía el catch', async () => {
    const svc = Object.create(WirelessService.prototype) as any;
    svc.pool = { execute: jest.fn(async () => { throw new Error('No se pudo conectar al router'); }) };
    const r = await svc.eliminarMacAccessList(creds, 'aa:bb:cc:dd:ee:ff');
    expect(r.clase).toBe('reintentable');
  });
});
