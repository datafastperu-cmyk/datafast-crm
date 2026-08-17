import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { SmartoltApiService } from './smartolt-api.service';

// Ola 1, grupo 3a (2026-08-16) — conversión de aprovisionarOnu(), técnico→técnico
// (único llamador: OltNativoService.provisionarViaSmartolt()). Primera de las 26
// capacidades que crea un recurso cuyo identificador el llamador realmente necesita —
// resuelto con un tipo `ResultadoAprovisionarOnu` local y transitorio (retirar en la
// Ola 3), nunca extendiendo el `ResultadoOperacion` compartido (ver comentario en el
// propio servicio).
describe('SmartoltApiService.aprovisionarOnu() — clasificación por rama', () => {
  const payload = { serial: 'sn1', olt_id: 'olt-1', pon_port: '0/1', profile: 'p', vlan: 100 };

  const hacer = (over: Record<string, unknown> = {}) => {
    const svc = Object.create(SmartoltApiService.prototype) as any;
    svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    svc.assertNotDegraded = jest.fn();
    svc.post = jest.fn(async () => ({ id: 'onu-1', serial: 'SN1' }));
    Object.assign(svc, over);
    return svc;
  };

  it('aplicado: ONU aprovisionada, con el payload transitorio `onu`', async () => {
    const svc = hacer();
    const r = await svc.aprovisionarOnu(payload);
    expect(r.clase).toBe('aplicado');
    expect(r.onu.id).toBe('onu-1');
  });

  it('rechazado_definitivo: SmartOLT no devolvió un id válido', async () => {
    const svc = hacer({ post: jest.fn(async () => ({})) });
    const r = await svc.aprovisionarOnu(payload);
    expect(r.clase).toBe('rechazado_definitivo');
  });

  it('rechazado_definitivo: SmartOLT rechazó la solicitud (404/400 vía clasificarError)', async () => {
    const svc = hacer({ post: jest.fn(async () => { throw new NotFoundException('recurso no encontrado'); }) });
    const r = await svc.aprovisionarOnu(payload);
    expect(r.clase).toBe('rechazado_definitivo');
  });

  it('reintentable: SmartOLT no disponible / error de red (503 vía clasificarError)', async () => {
    const svc = hacer({ post: jest.fn(async () => { throw new ServiceUnavailableException('SmartOLT no disponible'); }) });
    const r = await svc.aprovisionarOnu(payload);
    expect(r.clase).toBe('reintentable');
  });

  it('el error inesperado no lanza: cae en clasificarError vía el catch (módulo degradado)', async () => {
    const svc = hacer({ assertNotDegraded: jest.fn(() => { throw new ServiceUnavailableException('Módulo SmartOLT no disponible'); }) });
    await expect(svc.aprovisionarOnu(payload)).resolves.toHaveProperty('clase');
  });
});

// Ola 1, grupo 3b (2026-08-16) — único llamador: ContratosService.desaprovisionarOlt().
describe('SmartoltApiService.eliminarProvision() — clasificación por rama', () => {
  const hacer = (over: Record<string, unknown> = {}) => {
    const svc = Object.create(SmartoltApiService.prototype) as any;
    svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    svc.assertNotDegraded = jest.fn();
    svc.delete = jest.fn(async () => {});
    Object.assign(svc, over);
    return svc;
  };

  it('aplicado: provisión eliminada', async () => {
    const svc = hacer();
    const r = await svc.eliminarProvision('olt-1', 'onu-1');
    expect(r.clase).toBe('aplicado');
  });

  // Corrección de clasificación (D-14): un 404 al ELIMINAR es el destino alcanzado, no un
  // rechazo — clasificarError() por defecto lo mandaría a rechazado_definitivo porque no
  // distingue el verbo HTTP.
  it('ya_en_destino: la ONU ya no existía en SmartOLT (404)', async () => {
    const svc = hacer({ delete: jest.fn(async () => { throw new NotFoundException('recurso no encontrado'); }) });
    const r = await svc.eliminarProvision('olt-1', 'onu-1');
    expect(r.clase).toBe('ya_en_destino');
  });

  it('reintentable: SmartOLT no disponible / error de red', async () => {
    const svc = hacer({ delete: jest.fn(async () => { throw new ServiceUnavailableException('SmartOLT no disponible'); }) });
    const r = await svc.eliminarProvision('olt-1', 'onu-1');
    expect(r.clase).toBe('reintentable');
  });

  it('el error inesperado no lanza: cae en clasificarError vía el catch', async () => {
    const svc = hacer({ assertNotDegraded: jest.fn(() => { throw new ServiceUnavailableException('Módulo SmartOLT no disponible'); }) });
    await expect(svc.eliminarProvision('olt-1', 'onu-1')).resolves.toHaveProperty('clase');
  });
});
