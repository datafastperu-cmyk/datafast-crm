import { CronJob } from 'cron';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronLatidoService } from './cron-latido.service';
import { WatcherHeartbeatService } from './watcher-heartbeat.service';

// ═══════════════════════════════════════════════════════════════════════════
// Los tests de A-3 (2026-08-07): de 47 crons del ERP, latía 1.
//
// `WatcherHeartbeatService` llevaba desde el 28/07 haciendo bien su trabajo y su módulo
// era @Global() precisamente "para que no haya watchers sin latido". No bastó: quitaba la
// fricción de importar y dejaba la de llamar. Estos tests sostienen que ahora el latido se
// DERIVA de estar registrado, y no de que el autor se acuerde.
// ═══════════════════════════════════════════════════════════════════════════
describe('CronLatidoService — el latido no depende de que nadie se acuerde (A-3)', () => {
  let registry: SchedulerRegistry;
  let heartbeat: jest.Mocked<Pick<WatcherHeartbeatService, 'ejecutar'>>;
  let cronsPrevio: string | undefined;

  const nuevoServicio = () =>
    new CronLatidoService(registry, heartbeat as unknown as WatcherHeartbeatService);

  // El wrapper real de `ejecutar`: llama a fn y devuelve su resultado, como el de verdad.
  const heartbeatReal = () =>
    jest.fn(async (_n: string, _i: number, fn: () => Promise<unknown>) => fn());

  beforeEach(() => {
    cronsPrevio = process.env.RUN_CRONS;
    process.env.RUN_CRONS = 'true';
    registry  = new SchedulerRegistry();
    heartbeat = { ejecutar: heartbeatReal() } as never;
  });

  afterEach(() => {
    if (cronsPrevio === undefined) delete process.env.RUN_CRONS;
    else process.env.RUN_CRONS = cronsPrevio;
  });

  // Job real de la librería `cron`, sin arrancar (start=false): los tests disparan el tick
  // a mano. Usar el objeto real y no un doble es deliberado — lo que se está probando es
  // justamente que la interceptación funciona sobre la estructura real de la librería.
  const jobReal = (expr: string, cb: () => unknown) =>
    new CronJob(expr, cb as () => void, null, false, 'America/Lima');

  const dispararTick = async (job: CronJob) => {
    // Réplica de lo que hace `fireOnTick()` en cron 3.x, pero esperando el resultado para
    // que el test pueda observar el latido; la librería lo lanza sin await.
    for (const cb of (job as unknown as { _callbacks: Array<() => unknown> })._callbacks) {
      await cb.call((job as unknown as { context: unknown }).context);
    }
  };

  it('un cron registrado late aunque su autor no haya escrito una sola línea de latido', async () => {
    const svc = nuevoServicio();
    svc.onModuleInit();

    const trabajo = jest.fn(async () => 'hecho');
    const job = jobReal('*/2 * * * *', trabajo);
    registry.addCronJob('cron-que-nadie-instrumento', job);

    await dispararTick(job);

    expect(trabajo).toHaveBeenCalledTimes(1);
    expect(heartbeat.ejecutar).toHaveBeenCalledWith(
      'cron-que-nadie-instrumento',
      expect.any(Number),
      expect.any(Function),
    );
  });

  it('el intervalo esperado se deduce de la propia expresión cron, no se declara a mano', async () => {
    const svc = nuevoServicio();
    svc.onModuleInit();

    const cadaDosMin = jobReal('*/2 * * * *', () => undefined);
    const cadaHora   = jobReal('0 * * * *',   () => undefined);
    registry.addCronJob('cada-dos-minutos', cadaDosMin);
    registry.addCronJob('cada-hora',        cadaHora);

    await dispararTick(cadaDosMin);
    await dispararTick(cadaHora);

    const intervaloDe = (nombre: string) =>
      heartbeat.ejecutar.mock.calls.find((c) => c[0] === nombre)?.[1];

    expect(intervaloDe('cada-dos-minutos')).toBe(120);
    expect(intervaloDe('cada-hora')).toBe(3600);
  });

  // La razón de ser del barrido de onApplicationBootstrap: el SchedulerOrchestrator de
  // NestJS monta los @Cron en su propio hook, y el orden entre módulos depende del grafo
  // de dependencias. Un job registrado antes de que el parche estuviera puesto tiene que
  // acabar envuelto igual.
  it('barre los crons ya registrados antes de que el parche estuviera puesto', async () => {
    const job = jobReal('*/5 * * * *', jest.fn());
    registry.addCronJob('registrado-antes-del-parche', job);   // sin servicio aún

    const svc = nuevoServicio();
    svc.onModuleInit();
    svc.onApplicationBootstrap();

    await dispararTick(job);
    expect(heartbeat.ejecutar).toHaveBeenCalledWith(
      'registrado-antes-del-parche', expect.any(Number), expect.any(Function),
    );
  });

  it('envolver dos veces el mismo job no duplica el latido', async () => {
    const svc = nuevoServicio();
    svc.onModuleInit();

    const job = jobReal('*/5 * * * *', jest.fn());
    registry.addCronJob('idempotente', job);
    svc.onApplicationBootstrap();   // segunda pasada sobre el mismo job

    await dispararTick(job);
    expect(heartbeat.ejecutar).toHaveBeenCalledTimes(1);
  });

  // `@Cron()` sin `name:` recibe un UUID v4 nuevo en CADA arranque. Si se envolviera, cada
  // despliegue dejaría una fila huérfana por cron y `rancios()` gritaría por todas ellas.
  it('un cron con clave UUID (sin `name:`) no se envuelve: se denuncia', async () => {
    const svc = nuevoServicio();
    svc.onModuleInit();

    const job = jobReal('*/5 * * * *', jest.fn());
    registry.addCronJob('3f2504e0-4f89-41d3-9a0c-0305e82c3301', job);

    await dispararTick(job);

    expect(heartbeat.ejecutar).not.toHaveBeenCalled();
    expect(svc.diagnostico().sinNombre).toBe(1);
  });

  // La mitad crítica del diseño. api-core arranca los crons con un guard que retorna al
  // instante; si allí también se registrara el latido, la tabla se vería sana justo
  // mientras el worker está muerto — el fallo exacto que A-3 existe para detectar.
  it('en el proceso que NO ejecuta crons no se registra latido alguno', async () => {
    process.env.RUN_CRONS = 'false';
    const svc = nuevoServicio();
    svc.onModuleInit();

    const job = jobReal('*/5 * * * *', jest.fn());
    registry.addCronJob('cron-en-api-core', job);
    svc.onApplicationBootstrap();

    await dispararTick(job);

    expect(heartbeat.ejecutar).not.toHaveBeenCalled();
    expect(svc.diagnostico().activo).toBe(false);
  });

  it('el error del cron se propaga: el latido observa, no traga', async () => {
    const svc = nuevoServicio();
    svc.onModuleInit();

    // `ejecutar` real registra en el `finally` y relanza; se replica ese contrato.
    heartbeat.ejecutar.mockImplementation(async (_n, _i, fn) => fn());

    const job = jobReal('*/5 * * * *', () => { throw new Error('el cron reventó'); });
    registry.addCronJob('cron-que-revienta', job);

    await expect(dispararTick(job)).rejects.toThrow('el cron reventó');
  });
});
