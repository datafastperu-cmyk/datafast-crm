import { FirewallService } from './firewall.service';

// Ola 1, grupo 3b, bloque grande (2026-08-17) — las 3 sin ninguna condición de
// rechazado_definitivo (ver F-0.1 §9.1: página de criterios aprobada antes de convertir):
// escrituras idempotentes sobre address-lists, sin gate de datos.
describe('FirewallService — clasificación por rama', () => {
  const creds = { id: 'r-1', ip: '10.0.0.1', port: 8728, user: 'admin', passwordCifrado: '', useSsl: false, timeoutSec: 15, version: 'v7' } as any;

  const hacer = (writeImpl: (path: string, params?: string[]) => any) => {
    const svc = Object.create(FirewallService.prototype) as any;
    svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    svc.pool = { execute: jest.fn((_creds: any, fn: any) => fn({ write: jest.fn(writeImpl) })) };
    return svc;
  };

  it('suspenderCliente(): aplicado', async () => {
    const svc = hacer(() => []);
    const r = await svc.suspenderCliente(creds, '10.0.0.5', 'cli-1');
    expect(r.clase).toBe('aplicado');
  });

  it('reactivarCliente(): aplicado', async () => {
    const svc = hacer(() => []);
    const r = await svc.reactivarCliente(creds, '10.0.0.5');
    expect(r.clase).toBe('aplicado');
  });

  it('aplicarProrroga(): aplicado', async () => {
    const svc = hacer(() => []);
    const r = await svc.aplicarProrroga(creds, '10.0.0.5');
    expect(r.clase).toBe('aplicado');
  });

  // Trampa 2 (F-0.1 §9.1): un timeout de CONEXIÓN es reintentable, no indeterminado — nada
  // se envió al router. Se ejercita aquí para probar que las 3 capacidades usan el
  // clasificador de borde de mikrotik (clasificarErrorMikrotik), no clasificarError() genérico.
  it('suspenderCliente(): timeout de conexión es reintentable, no indeterminado', async () => {
    const svc = hacer(() => { throw new Error('Timeout conectando a 10.0.0.1:8728'); });
    const r = await svc.suspenderCliente(creds, '10.0.0.5', 'cli-1');
    expect(r.clase).toBe('reintentable');
  });

  it('reactivarCliente(): timeout de comando es indeterminado (D-14 §2)', async () => {
    const svc = hacer(() => { throw new Error('Timeout de comando en 10.0.0.1 (20s)'); });
    const r = await svc.reactivarCliente(creds, '10.0.0.5');
    expect(r.clase).toBe('indeterminado');
  });
});
