import { SchedulerRegistry } from '@nestjs/schedule';
import { LatidoVigilanteService } from './latido-vigilante.service';
import { WatcherHeartbeatService } from './watcher-heartbeat.service';
import { EventosSistemaService } from '../../modules/sistema/eventos-sistema.service';

// ═══════════════════════════════════════════════════════════════════════════
// Desviación A-3: "el worker puede morir en silencio".
//
// El latido existía y se exponía en `GET /admin/sistema/watchers`. Ese endpoint es
// CONSULTABLE, no VIGILANTE: responde a quien pregunta, y nadie pregunta por algo que
// parece funcionar. El ERP puede pasar días atendiendo con normalidad mientras nadie se
// corta, nadie se reactiva y ningún pago se reconcilia.
//
// Aquí se sostiene lo que el diseño afirma, en vez de dejarlo escrito en un comentario.
// ═══════════════════════════════════════════════════════════════════════════
describe('LatidoVigilanteService — el que responde denuncia al que no late (A-3)', () => {
  let heartbeat: { estadoDelPlano: jest.Mock; rancios: jest.Mock };
  let eventos:   { registrarSiNoExiste: jest.Mock };
  let registry:  SchedulerRegistry;
  let cronsPrevio: string | undefined;
  let uptimeSpy: jest.SpyInstance;

  const nuevo = () =>
    new LatidoVigilanteService(
      heartbeat as unknown as WatcherHeartbeatService,
      eventos   as unknown as EventosSistemaService,
      registry,
    );

  const plano = (segundos: number | null, total = 40) => ({
    totalWatchers: total,
    ultimoLatido: segundos === null ? null : new Date(Date.now() - segundos * 1000).toISOString(),
    segundosDesdeUltimoLatido: segundos,
  });

  beforeEach(() => {
    cronsPrevio = process.env.RUN_CRONS;
    process.env.RUN_CRONS = 'false';            // el proceso que responde
    registry  = new SchedulerRegistry();
    heartbeat = { estadoDelPlano: jest.fn(), rancios: jest.fn().mockResolvedValue([]) };
    eventos   = { registrarSiNoExiste: jest.fn().mockResolvedValue(true) };
    // Por defecto, proceso ya asentado: fuera de la gracia de arranque.
    uptimeSpy = jest.spyOn(process, 'uptime').mockReturnValue(7200);
  });

  afterEach(() => {
    // El CronJob de vigilancia arranca con `start = true`: si no se para, deja un timer
    // vivo y jest tiene que matar el worker a la fuerza.
    for (const job of registry.getCronJobs().values()) job.stop();
    uptimeSpy.mockRestore();
    if (cronsPrevio === undefined) delete process.env.RUN_CRONS;
    else process.env.RUN_CRONS = cronsPrevio;
  });

  it('denuncia el plano mudo cuando nadie ha latido pasado el umbral', async () => {
    heartbeat.estadoDelPlano.mockResolvedValue(plano(3600));

    const diag = await nuevo().vigilar();

    expect(diag?.mudo).toBe(true);
    expect(eventos.registrarSiNoExiste).toHaveBeenCalledWith(
      'PLANO_AUTOMATICO_MUDO',
      expect.any(Number),
      expect.objectContaining({ nivel: 'critical', origen: 'scheduler' }),
    );
  });

  // Con el worker muerto TODOS los watchers están rancios a la vez. Cuarenta eventos que
  // dicen lo mismo esconden el único que hay que leer.
  it('con el plano mudo emite UNA causa, no un evento por cada watcher caído', async () => {
    heartbeat.estadoDelPlano.mockResolvedValue(plano(3600));
    heartbeat.rancios.mockResolvedValue(
      Array.from({ length: 40 }, (_, i) => ({
        nombre: `watcher-${i}`, ultimaEjecucion: new Date(), segundosSinLatir: 3600,
        intervaloEsperadoSeg: 120, exito: true, ultimoError: null,
      })),
    );

    await nuevo().vigilar();

    expect(eventos.registrarSiNoExiste).toHaveBeenCalledTimes(1);
    expect(eventos.registrarSiNoExiste.mock.calls[0][0]).toBe('PLANO_AUTOMATICO_MUDO');
  });

  it('con el plano vivo denuncia solo al watcher concreto que se quedó atrás', async () => {
    heartbeat.estadoDelPlano.mockResolvedValue(plano(30));
    heartbeat.rancios.mockResolvedValue([{
      nombre: 'ztp-reinyeccion-pendiente', ultimaEjecucion: new Date(),
      segundosSinLatir: 1800, intervaloEsperadoSeg: 120, exito: false, ultimoError: 'boom',
    }]);

    const diag = await nuevo().vigilar();

    expect(diag?.mudo).toBe(false);
    expect(eventos.registrarSiNoExiste).toHaveBeenCalledTimes(1);
    expect(eventos.registrarSiNoExiste.mock.calls[0][0]).toBe('WATCHER_RANCIO:ztp-reinyeccion-pendiente');
  });

  it('todo en orden: no escribe nada', async () => {
    heartbeat.estadoDelPlano.mockResolvedValue(plano(45));

    const diag = await nuevo().vigilar();

    expect(diag?.mudo).toBe(false);
    expect(eventos.registrarSiNoExiste).not.toHaveBeenCalled();
  });

  // Un despliegue reinicia los dos procesos y el que responde arranca antes que el que
  // trabaja. Sin gracia, cada despliegue generaría una alarma falsa — y una alarma que
  // grita cuando todo va bien deja de leerse.
  it('recién arrancado no denuncia: la tabla está fría por el despliegue, no por avería', async () => {
    uptimeSpy.mockReturnValue(30);
    heartbeat.estadoDelPlano.mockResolvedValue(plano(null));

    const diag = await nuevo().vigilar();

    expect(diag?.mudo).toBe(false);
    expect(eventos.registrarSiNoExiste).not.toHaveBeenCalled();
  });

  // El heartbeat SUPRIME la alarma, nunca la autoriza: pasado el margen, el veredicto
  // depende solo del latido. Un proceso que lleva horas vivo con la tabla vacía significa
  // que nadie ha ejecutado un cron desde el arranque.
  it('pasada la gracia, una tabla vacía es plano mudo — no "aún no hay datos"', async () => {
    heartbeat.estadoDelPlano.mockResolvedValue(plano(null, 0));

    const diag = await nuevo().vigilar();

    expect(diag?.mudo).toBe(true);
    expect(eventos.registrarSiNoExiste).toHaveBeenCalledWith(
      'PLANO_AUTOMATICO_MUDO', expect.any(Number), expect.objectContaining({ nivel: 'critical' }),
    );
  });

  // Un vigilante alojado en el worker muere con él: sería un testigo que se apaga con la
  // luz. Por eso solo vigila el proceso sin crons.
  it('el proceso que ejecuta los crons no se vigila a sí mismo', () => {
    process.env.RUN_CRONS = 'true';
    const svc = nuevo();
    svc.onModuleInit();

    expect(registry.getCronJobs().has('latido-vigilante')).toBe(false);
  });

  it('el proceso que responde sí instala la vigilancia', () => {
    const svc = nuevo();
    svc.onModuleInit();

    expect(registry.getCronJobs().has('latido-vigilante')).toBe(true);
  });

  // Un mecanismo de observación que tumba lo observado es peor que no tenerlo.
  it('si la consulta de diagnóstico falla, la pasada no lanza', async () => {
    heartbeat.estadoDelPlano.mockRejectedValue(new Error('BD caída'));

    await expect(nuevo().vigilar()).resolves.toBeNull();
  });
});
