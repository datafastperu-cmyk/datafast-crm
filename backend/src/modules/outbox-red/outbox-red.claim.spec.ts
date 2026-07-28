import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OutboxRedService } from './outbox-red.service';
import { FirewallService } from '../mikrotik/services/firewall.service';
import { PppoeService } from '../mikrotik/services/pppoe.service';
import { QueueService } from '../mikrotik/services/queue.service';
import { ProvisionFtthService } from '../olt-nativo/services/provision-ftth.service';

// Directriz "VIO hacia adentro": el barrido del outbox afirma exclusión mutua entre
// instancias PM2. La versión anterior lo afirmaba en un comentario y era FALSA — el
// SELECT ... FOR UPDATE SKIP LOCKED soltaba el lock al cerrar la transacción, antes de
// ejecutar contra el hardware (producción 2026-07-28: api-core y worker tomaron el
// mismo comando en el mismo tick). Una garantía de concurrencia sin test que la
// ejercite es una garantía sin verificar.
//
// Estos tests fijan las tres propiedades que el reclamo atómico debe cumplir. No
// necesitan Postgres: verifican la FORMA del reclamo (una sola sentencia mutante que
// devuelve el lote ya reclamado) y que toda salida libere el reclamo, que es donde
// estuvo el defecto.
describe('OutboxRedService — reclamo atómico', () => {
  let svc: OutboxRedService;
  let queries: Array<{ sql: string; params?: any[] }>;
  let filasReclamo: any[];

  const noop = () => ({});

  beforeEach(async () => {
    queries = [];
    filasReclamo = [];
    const dsMock = {
      // El mock IMITA EL CONTRATO REAL DEL DRIVER, no una versión conveniente de él:
      // TypeORM/Postgres devuelve `[filas, rowCount]` para UPDATE y DELETE, y `filas`
      // a secas para SELECT. Un mock que devuelve siempre `[]` deja pasar exactamente
      // el bug que rompió el drenado del outbox en producción (2026-07-28): el código
      // iteraba sobre [arrayDeFilas, número] y no procesaba nada, sin un solo error.
      query: jest.fn(async (sql: string, params?: any[]) => {
        queries.push({ sql, params });
        const esMutante = /^\s*(UPDATE|DELETE)/i.test(sql);
        if (!esMutante) return [];
        const filas = /RETURNING/i.test(sql) ? filasReclamo : [];
        return [filas, filas.length];
      }),
      transaction: jest.fn(async (cb: any) => cb({ query: jest.fn(async () => []) })),
    };

    const mod = await Test.createTestingModule({
      providers: [
        OutboxRedService,
        { provide: getDataSourceToken(), useValue: dsMock },
        { provide: FirewallService,      useValue: noop() },
        { provide: PppoeService,         useValue: noop() },
        { provide: QueueService,         useValue: noop() },
        { provide: ProvisionFtthService, useValue: noop() },
        { provide: EventEmitter2,        useValue: { emit: jest.fn() } },
      ],
    }).compile();

    svc = mod.get(OutboxRedService);
  });

  it('reclama y lee en UNA sola sentencia mutante (no SELECT + ejecución fuera de transacción)', async () => {
    await svc.procesarPendientes();

    const reclamo = queries.find((q) => /RETURNING/i.test(q.sql) && /EN_PROCESO/.test(q.sql));
    expect(reclamo).toBeDefined();

    // La sentencia que obtiene el lote DEBE ser la que marca el reclamo: si fuese un
    // SELECT, entre leer y marcar habría una ventana para la otra instancia PM2.
    expect(reclamo!.sql).toMatch(/^\s*UPDATE\s+comandos_red_pendientes/i);
    expect(reclamo!.sql).toMatch(/SET\s+estado\s*=\s*'EN_PROCESO'/i);
    expect(reclamo!.sql).toMatch(/FOR UPDATE SKIP LOCKED/i);

    // Y debe persistir dueño + expiración: sin TTL, un proceso muerto retiene el
    // comando para siempre; sin dueño, no hay forma de diagnosticar quién lo tomó.
    expect(reclamo!.sql).toMatch(/reclamado_por/);
    expect(reclamo!.sql).toMatch(/claim_expira_en/);
  });

  it('no toma comandos ya reclamados por otra instancia', async () => {
    await svc.procesarPendientes();

    const reclamo = queries.find((q) => /RETURNING/i.test(q.sql) && /EN_PROCESO/.test(q.sql))!;
    // El candidato se restringe a PENDIENTE: un EN_PROCESO de otra instancia queda fuera.
    expect(reclamo.sql).toMatch(/WHERE\s+estado\s*=\s*'PENDIENTE'/i);
    expect(reclamo.sql).not.toMatch(/estado\s*IN\s*\(\s*'PENDIENTE'\s*,\s*'EN_PROCESO'/i);
  });

  it('el barrido de claims expirados devuelve a PENDIENTE solo lo vencido y libera el reclamo', async () => {
    process.env.RUN_CRONS = 'true';
    await svc.barrerClaimsExpirados();
    delete process.env.RUN_CRONS;

    const barrido = queries.find((q) => /claim_expira_en\s*<\s*NOW\(\)/i.test(q.sql));
    expect(barrido).toBeDefined();
    expect(barrido!.sql).toMatch(/estado\s*=\s*'EN_PROCESO'\s+AND\s+claim_expira_en\s*<\s*NOW\(\)/i);
    expect(barrido!.sql).toMatch(/SET\s+estado\s*=\s*'PENDIENTE'/i);
    expect(barrido!.sql).toMatch(/reclamado_por\s*=\s*NULL/i);
  });

  it('interpreta [filas, rowCount] del driver: procesa los comandos reclamados', async () => {
    // Regresión directa del bug del 2026-07-28. Si el código vuelve a tratar el retorno
    // del UPDATE como un array de filas, iterará sobre [array, número] y ejecutará
    // basura: aquí eso se manifiesta como que NO se consulta el router del comando.
    filasReclamo = [{
      id: 29, contrato_id: 'c-1', router_id: 'r-1',
      accion: 'PROVISIONAR', payload: {}, intentos: 0, max_intentos: 12,
    }];

    await svc.procesarPendientes();

    // Un comando MikroTik reclamado tiene que llegar a consultar su router.
    const consultaRouter = queries.find((q) => /FROM\s+routers\s+WHERE\s+id/i.test(q.sql));
    expect(consultaRouter).toBeDefined();
    expect(consultaRouter!.params).toEqual(['r-1']);
  });

  it('el barrido programado respeta RUN_CRONS; el trigger por evento no', async () => {
    delete process.env.RUN_CRONS;
    await svc.barridoProgramado();
    expect(queries.length).toBe(0); // api-core no barre por cron

    await svc.onRouterReconectado();
    expect(queries.length).toBeGreaterThan(0); // pero sí reacciona al router que vuelve
  });
});
