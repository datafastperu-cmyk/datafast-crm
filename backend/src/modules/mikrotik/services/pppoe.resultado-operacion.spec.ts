import { PppoeService } from './pppoe.service';

// Ola 1, grupo 3b, bloque grande (2026-08-17). Las 4 sin ninguna condición de
// rechazado_definitivo — ver F-0.1 §9.1 (página de criterios aprobada antes de convertir).
describe('PppoeService — clasificación por rama', () => {
  const creds = { id: 'r-1', ip: '10.0.0.1', port: 8728, user: 'admin', passwordCifrado: '', useSsl: false, timeoutSec: 15, version: 'v7' } as any;

  const hacer = (writeImpl: (path: string, params?: string[]) => any) => {
    const svc = Object.create(PppoeService.prototype) as any;
    svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    svc.pool = { execute: jest.fn((_creds: any, fn: any) => fn({ write: jest.fn(writeImpl) })) };
    return svc;
  };

  it('crear(): aplicado', async () => {
    const svc = hacer((path: string) => (/add$/.test(path) ? [{ ret: '*1' }] : []));
    const r = await svc.crear(creds, { name: 'u1', password: 'p', profile: 'default', service: 'pppoe', disabled: false });
    expect(r.clase).toBe('aplicado');
  });

  // eliminar()/setEstado(): "no existe" es ya_en_destino, no no_aplica — el estado destino
  // (sin secret / ya deshabilitado) ya estaba alcanzado, la operación SÍ aplicaba al sujeto.
  it('eliminar(): ya_en_destino cuando el secret no existe', async () => {
    const svc = hacer(() => []);
    const r = await svc.eliminar(creds, 'u1');
    expect(r.clase).toBe('ya_en_destino');
  });

  it('eliminar(): aplicado cuando sí existía', async () => {
    const svc = hacer((path: string) => (/print$/.test(path) ? [{ '.id': '*1' }] : []));
    const r = await svc.eliminar(creds, 'u1');
    expect(r.clase).toBe('aplicado');
  });

  it('setEstado(): ya_en_destino cuando el secret no existe', async () => {
    const svc = hacer(() => []);
    const r = await svc.setEstado(creds, 'u1', true);
    expect(r.clase).toBe('ya_en_destino');
  });

  it('desconectarSesion(): ya_en_destino cuando no hay sesión activa', async () => {
    const svc = hacer(() => []);
    const r = await svc.desconectarSesion(creds, 'u1');
    expect(r.clase).toBe('ya_en_destino');
  });

  it('desconectarSesion(): aplicado cuando había sesión activa', async () => {
    const svc = hacer((path: string) => (/print$/.test(path) ? [{ '.id': '*1' }] : []));
    const r = await svc.desconectarSesion(creds, 'u1');
    expect(r.clase).toBe('aplicado');
  });

  // Trampa 2 (F-0.1 §9.1): timeout de conexión → reintentable; timeout de comando →
  // indeterminado. Comparte el clasificador de borde con FirewallService/QueueService.
  it('crear(): timeout de conexión es reintentable', async () => {
    const svc = hacer(() => { throw new Error('Timeout conectando a 10.0.0.1:8728'); });
    const r = await svc.crear(creds, { name: 'u1', password: 'p', profile: 'default', service: 'pppoe', disabled: false });
    expect(r.clase).toBe('reintentable');
  });

  it('setEstado(): timeout de comando es indeterminado', async () => {
    const svc = hacer(() => { throw new Error('Timeout de comando en 10.0.0.1 (20s)'); });
    const r = await svc.setEstado(creds, 'u1', true);
    expect(r.clase).toBe('indeterminado');
  });
});
