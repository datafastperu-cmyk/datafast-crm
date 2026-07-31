import { OltSyncService } from './olt-sync.service';

// TTL de los jobs de sincronización.
//
// Incidente 2026-07-29: el worker se reinició a mitad de un sync y dejó la fila en
// 'running' a las 06:50. Durante 40 h TODAS las ejecuciones del cron encontraron ese
// zombi, devolvieron su id y no sincronizaron nada. El inventario de ONUs se congeló
// 25 h, así que el portal y /red/olt mostraban un snapshot viejo como estado actual —
// y el latido decía `{encoladas: 1, exito: true}` porque contaba "devolví un id".
//
// Estas pruebas fijan las dos mitades del arreglo: que un 'running' vencido se libera y
// deja arrancar un sync nuevo, y que uno reciente sigue protegido (no duplicar syncs
// contra un MA5800 que admite pocas sesiones VTY es la razón de que el guard exista).

describe('OltSyncService — liberación de jobs abandonados', () => {
  /**
   * Construye el servicio con lo mínimo que toca `iniciarSync`. El resto de dependencias
   * no se ejercitan en esta ruta; pasarlas como `{}` mantiene la prueba centrada en el
   * TTL en lugar de montar medio módulo de OLT.
   */
  function crear(opciones: {
    /** Filas que devuelve el UPDATE de liberación (las que vencieron). */
    liberados?: Array<{ id: string }>;
    /** Job 'running' que sigue vivo tras la liberación, si lo hay. */
    runningVivo?: { id: string } | null;
  }) {
    const query = jest.fn()
      // 1.ª llamada: SELECT de la OLT (activa)
      .mockResolvedValueOnce([{ nombre: 'OLT TEST', activo: true }])
      // 2.ª llamada: UPDATE ... RETURNING de los vencidos
      .mockResolvedValueOnce(opciones.liberados ?? []);

    const syncJobRepo = {
      findOne: jest.fn().mockResolvedValue(opciones.runningVivo ?? null),
      create:  jest.fn().mockImplementation((v: object) => ({ ...v, id: 'job-nuevo' })),
      save:    jest.fn().mockImplementation((v: object) => Promise.resolve(v)),
    };

    const svc = new OltSyncService(
      {} as never, {} as never, {} as never, {} as never, {} as never,
      syncJobRepo as never,
      {} as never, {} as never, {} as never, {} as never,
      { query } as never,
      {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    );

    // El sync real se lanza sin await; aquí no debe tocar la OLT.
    (svc as unknown as { _ejecutarSync: () => Promise<void> })._ejecutarSync =
      jest.fn().mockResolvedValue(undefined);

    return { svc, query, syncJobRepo };
  }

  it('libera el job vencido y arranca uno nuevo (incidente 29/07)', async () => {
    // El UPDATE devuelve el zombi liberado y ya no queda ningún 'running' vivo.
    const { svc, query, syncJobRepo } = crear({
      liberados: [{ id: 'job-zombi' }],
      runningVivo: null,
    });

    const res = await svc.iniciarSync('olt-1', 'emp-1');

    // Lo esencial: se arranca un sync NUEVO. Antes se devolvía el zombi para siempre.
    expect(res.nuevo).toBe(true);
    expect(res.jobId).toBe('job-nuevo');
    expect(syncJobRepo.save).toHaveBeenCalled();

    // La liberación es un UPDATE condicional, no un "leer → decidir → escribir": si dos
    // instancias coinciden, solo una toca la fila.
    const sqlLiberacion = String(query.mock.calls[1][0]);
    expect(sqlLiberacion).toMatch(/UPDATE\s+olt_sync_jobs/i);
    expect(sqlLiberacion).toMatch(/estado\s*=\s*'running'/i);
    expect(sqlLiberacion).toMatch(/iniciado_en\s*<\s*now\(\)/i);
  });

  it('respeta un sync en curso dentro de su TTL y no lo duplica', async () => {
    // Nada vencido; hay un job reciente todavía trabajando.
    const { svc, syncJobRepo } = crear({
      liberados: [],
      runningVivo: { id: 'job-en-curso' },
    });

    const res = await svc.iniciarSync('olt-1', 'emp-1');

    expect(res.nuevo).toBe(false);
    expect(res.jobId).toBe('job-en-curso');
    // No se crea otro: el MA5800 admite pocas sesiones VTY concurrentes.
    expect(syncJobRepo.save).not.toHaveBeenCalled();
  });
});
