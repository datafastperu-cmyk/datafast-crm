import { DataSource } from 'typeorm';

import { ConsumoColectorService } from './consumo-colector.service';
import { QueueService } from '../mikrotik/services/queue.service';
import { ModuleHealthService } from '../../common/services/module-health.service';

// Los contadores de RouterOS son ACUMULADOS desde que la queue se creó. Todo el colector
// se sostiene sobre convertirlos en deltas correctamente; estos tests fijan los tres casos
// que, mal resueltos, le muestran al abonado un consumo que no existió:
//
//   · primera lectura   → no hay con qué comparar; escribirla sería volcar el histórico
//     entero como consumo de esta hora.
//   · contador reiniciado (reboot del router, queue recreada al cambiar de plan) → el
//     delta da negativo; restarlo contaminaría el total del mes.
//   · dos corridas en la misma hora → deben SUMAR en la misma fila, no duplicarla.

const ROUTER = {
  id: 'router-1', empresa_id: 'empresa-1', ip: '10.8.0.2',
  usuario: 'api', password_cifrado: 'x', usar_ssl: false,
  puerto_api: 8728, puerto_api_ssl: 8729, timeout_conexion: 10,
};

const CONTRATO = {
  contrato_id: 'contrato-1', cliente_id: 'cliente-1',
  empresa_id: 'empresa-1', nombre_queue: 'q-cliente-1',
};

interface Escenario {
  snapshotPrevio?: { rx: number; tx: number };
  // RouterOS: "bytes" viene como "entrada/salida" — subida/bajada del abonado.
  bytesQueue: string;
}

function colectorCon({ snapshotPrevio, bytesQueue }: Escenario) {
  const escrituras: Array<{ sql: string; params: unknown[] }> = [];

  const query = jest.fn((sql: string, params: unknown[] = []) => {
    escrituras.push({ sql, params });

    if (sql.includes('FROM routers r'))   return Promise.resolve([ROUTER]);
    if (sql.includes('FROM servicios'))   return Promise.resolve([CONTRATO]);
    if (sql.includes('FROM consumo_snapshot')) {
      return Promise.resolve(
        snapshotPrevio
          ? [{
              contrato_id: CONTRATO.contrato_id,
              rx_bytes: String(snapshotPrevio.rx),
              tx_bytes: String(snapshotPrevio.tx),
            }]
          : [],
      );
    }
    return Promise.resolve([]);
  });

  const queues = {
    listarSimpleQueues: jest.fn().mockResolvedValue([
      { name: CONTRATO.nombre_queue, bytes: bytesQueue },
    ]),
  } as unknown as QueueService;

  const salud = { registrar: jest.fn() } as unknown as ModuleHealthService;

  const svc = new ConsumoColectorService(
    { query } as unknown as DataSource,
    queues,
    salud,
  );

  const consumoEscrito = () =>
    escrituras.find((e) => e.sql.includes('INSERT INTO consumo_datos'));

  return { svc, consumoEscrito, escrituras, salud };
}

describe('ConsumoColectorService', () => {
  const original = process.env.CONSUMO_COLECTOR_ENABLED;

  beforeEach(() => { process.env.CONSUMO_COLECTOR_ENABLED = 'true'; });
  afterAll(() => {
    if (original === undefined) delete process.env.CONSUMO_COLECTOR_ENABLED;
    else process.env.CONSUMO_COLECTOR_ENABLED = original;
  });

  it('apagado por defecto: no habla con ningún router', async () => {
    process.env.CONSUMO_COLECTOR_ENABLED = 'false';
    const { svc, escrituras } = colectorCon({ bytesQueue: '1000/2000' });

    await expect(svc.recolectar()).resolves.toEqual({ routers: 0, contratos: 0, omitidos: 0 });
    expect(escrituras).toHaveLength(0);
  });

  it('primera lectura: guarda referencia y NO escribe consumo', async () => {
    const { svc, consumoEscrito } = colectorCon({ bytesQueue: '5000000/90000000' });

    const res = await svc.recolectar();

    expect(res.omitidos).toBe(1);
    expect(res.contratos).toBe(0);
    expect(consumoEscrito()).toBeUndefined();
  });

  it('segunda lectura: escribe la DIFERENCIA, no el acumulado', async () => {
    const { svc, consumoEscrito } = colectorCon({
      snapshotPrevio: { rx: 90_000_000, tx: 5_000_000 },
      bytesQueue: '6000000/100000000', // subida 6 MB, bajada 100 MB acumulados
    });

    const res = await svc.recolectar();

    expect(res.contratos).toBe(1);
    const insert = consumoEscrito()!;
    // params: [empresa, contrato, cliente, fecha, hora, rx, tx]
    expect(insert.params[5]).toBe(10_000_000); // bajada: 100 MB − 90 MB
    expect(insert.params[6]).toBe(1_000_000);  // subida: 6 MB − 5 MB
  });

  it('contador reiniciado: toma la lectura actual, nunca un delta negativo', async () => {
    // El router se reinició: el acumulado volvió casi a cero.
    const { svc, consumoEscrito } = colectorCon({
      snapshotPrevio: { rx: 90_000_000, tx: 5_000_000 },
      bytesQueue: '1000/50000',
    });

    await svc.recolectar();

    const insert = consumoEscrito()!;
    expect(insert.params[5]).toBe(50_000);
    expect(insert.params[6]).toBe(1_000);
    expect(Number(insert.params[5])).toBeGreaterThanOrEqual(0);
    expect(Number(insert.params[6])).toBeGreaterThanOrEqual(0);
  });

  it('sin tráfico nuevo no escribe una fila vacía', async () => {
    const { svc, consumoEscrito } = colectorCon({
      snapshotPrevio: { rx: 90_000_000, tx: 5_000_000 },
      bytesQueue: '5000000/90000000',
    });

    const res = await svc.recolectar();

    expect(res.contratos).toBe(0);
    expect(consumoEscrito()).toBeUndefined();
  });

  it('dos corridas en la misma hora SUMAN en la misma fila (no duplican)', async () => {
    const { svc, consumoEscrito } = colectorCon({
      snapshotPrevio: { rx: 0, tx: 0 },
      bytesQueue: '1000/2000',
    });

    await svc.recolectar();

    const insert = consumoEscrito()!;
    expect(insert.sql).toContain('ON CONFLICT (contrato_id, fecha, hora) DO UPDATE');
    expect(insert.sql).toContain('consumo_datos.rx_bytes + EXCLUDED.rx_bytes');
  });

  it('una sola llamada al router aunque haya varios contratos', async () => {
    const { svc } = colectorCon({
      snapshotPrevio: { rx: 0, tx: 0 },
      bytesQueue: '1000/2000',
    });

    await svc.recolectar();

    // `/queue/simple/print` devuelve todas las queues: con 200 abonados, una llamada por
    // contrato serían 200 conexiones cada 15 minutos contra el mismo router.
    expect(
      (svc as unknown as { queues: QueueService }).queues.listarSimpleQueues,
    ).toHaveBeenCalledTimes(1);
  });

  // El colector apagado no es una avería, pero explica el "Sin datos" que ve el abonado.
  // Publicarlo con su motivo evita que se diagnostique como un bug del portal.
  it('apagado: se publica en la salud del módulo con el motivo', () => {
    process.env.CONSUMO_COLECTOR_ENABLED = 'false';
    const { svc, salud } = colectorCon({ bytesQueue: '1000/2000' });

    svc.onModuleInit();

    expect(salud.registrar).toHaveBeenCalledWith(
      'portal-consumo', 'degraded', expect.stringContaining('CONSUMO_COLECTOR_ENABLED'),
    );
  });

  it('encendido: se publica como ok', () => {
    const { svc, salud } = colectorCon({ bytesQueue: '1000/2000' });

    svc.onModuleInit();

    expect(salud.registrar).toHaveBeenCalledWith('portal-consumo', 'ok');
  });

  it('un router inalcanzable no detiene la recolección', async () => {
    const { svc } = colectorCon({ bytesQueue: '1000/2000' });
    (svc as unknown as { queues: { listarSimpleQueues: jest.Mock } })
      .queues.listarSimpleQueues.mockRejectedValue(new Error('timeout'));

    await expect(svc.recolectar()).resolves.toMatchObject({ contratos: 0 });
  });
});
