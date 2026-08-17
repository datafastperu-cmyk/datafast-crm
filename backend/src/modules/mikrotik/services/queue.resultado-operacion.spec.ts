import { QueueService, QueueParams } from './queue.service';

// Ola 1, grupo 3b, bloque grande (2026-08-17). Ninguna condición de rechazado_definitivo:
// upsert puro (ver F-0.1 §9.1).
describe('QueueService — clasificación por rama', () => {
  const creds = { id: 'r-1', ip: '10.0.0.1', port: 8728, user: 'admin', passwordCifrado: '', useSsl: false, timeoutSec: 15, version: 'v7' } as any;
  const params: QueueParams = { name: 'q1', target: '10.0.0.5', maxLimitDown: 10, maxLimitUp: 5 };

  const hacer = (writeImpl: (path: string, params?: string[]) => any) => {
    const svc = Object.create(QueueService.prototype) as any;
    svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    svc.pool = { execute: jest.fn((_creds: any, fn: any) => fn({ write: jest.fn(writeImpl) })) };
    return svc;
  };

  it('crearSimpleQueue(): aplicado (creación)', async () => {
    const svc = hacer((path: string) => (/print$/.test(path) ? [] : []));
    const r = await svc.crearSimpleQueue(creds, params);
    expect(r.clase).toBe('aplicado');
  });

  it('crearSimpleQueue(): aplicado (actualización, ya existía)', async () => {
    const svc = hacer((path: string) => (/print$/.test(path) ? [{ '.id': '*1' }] : []));
    const r = await svc.crearSimpleQueue(creds, params);
    expect(r.clase).toBe('aplicado');
  });

  // Trampa 2 (F-0.1 §9.1): comparte clasificarErrorMikrotik con Firewall/Pppoe.
  it('crearSimpleQueue(): timeout de conexión es reintentable', async () => {
    const svc = hacer(() => { throw new Error('Timeout conectando a 10.0.0.1:8728'); });
    const r = await svc.crearSimpleQueue(creds, params);
    expect(r.clase).toBe('reintentable');
  });

  it('crearSimpleQueue(): timeout de comando es indeterminado', async () => {
    const svc = hacer(() => { throw new Error('Timeout de comando en 10.0.0.1 (20s)'); });
    const r = await svc.crearSimpleQueue(creds, params);
    expect(r.clase).toBe('indeterminado');
  });
});
