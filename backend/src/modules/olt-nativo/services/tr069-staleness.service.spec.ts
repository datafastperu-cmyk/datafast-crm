import { Tr069StalenessService } from './tr069-staleness.service';

// Un watcher que actúa sobre AUSENCIA de señal es peligroso por naturaleza: la ausencia
// es ambigua (apagada / sin fibra / gestión muerta) y actuar sobre la ambigüedad lo
// convierte en una fábrica de trabajo inútil contra la OLT. Estos tests fijan las tres
// defensas que lo hacen seguro. Si alguna cae, el watcher pasa a ser un riesgo.
describe('Tr069StalenessService', () => {
  const HORA = 60 * 60_000;

  const hacer = (opts: {
    candidatos: any[];
    lastInform: (sn: string) => Date | null;
    online?: boolean;
    pollFalla?: boolean;
  }) => {
    const emitidos: Array<{ evento: string; payload: any }> = [];
    const updates: Array<{ sql: string; params: any[] }> = [];

    const ds = {
      query: jest.fn(async (sql: string, params?: any[]) => {
        if (/FROM\s+ftth_onu_registro/i.test(sql) && /JOIN\s+servicios/i.test(sql)) {
          return opts.candidatos;
        }
        if (/FROM\s+olt_dispositivos/i.test(sql)) {
          return [{ ip_gestion: '10.11.104.2', puerto: 22, usuario_anclado: 'u', contrasena_cifrada: 'p', marca: 'huawei' }];
        }
        updates.push({ sql, params: params ?? [] });
        return [];
      }),
    };
    const genie = { getLastInformBySerial: jest.fn(async (sn: string) => opts.lastInform(sn)) };
    const automation = {
      ftthPollOnline: jest.fn(async () => {
        if (opts.pollFalla) throw new Error('OLT inalcanzable');
        return { success: true, run_state: opts.online ? 'online' : 'offline', timeout: false };
      }),
    };
    const events = { emit: jest.fn((evento: string, payload: any) => { emitidos.push({ evento, payload }); return true; }) };

    const svc = new Tr069StalenessService(ds as any, genie as any, automation as any, events as any);
    return { svc, emitidos, updates, automation, genie };
  };

  const onu = (id: string, sn: string, staleDesde: Date | null, oltId = 'olt-1') => ({
    id, contrato_id: `c-${id}`, empresa_id: 'e-1', sn,
    olt_id: oltId, slot: 1, port: 8, onu_id: Number(id.replace(/\D/g, '')) || 1,
    tr069_stale_desde: staleDesde,
  });

  // ── Defensa 1: gracia ───────────────────────────────────────────────
  it('NO acciona en la primera detección: solo marca y espera', async () => {
    const { svc, emitidos, updates } = hacer({
      candidatos: [onu('1', 'SN1', null)],
      lastInform: () => new Date(Date.now() - 5 * HORA),
    });

    const r = await svc.revisar();

    expect(r.rancias).toBe(1);
    expect(r.accionadas).toBe(0); // un microcorte no puede disparar trabajo contra la OLT
    expect(updates.some((u) => /tr069_stale_desde\s*=\s*NOW\(\)/i.test(u.sql))).toBe(true);
    expect(emitidos.filter((e) => e.evento === 'ftth.carril.activar')).toHaveLength(0);
  });

  it('una ONU que vuelve a informar limpia su marca (la gracia es ventana, no contador)', async () => {
    const { svc, updates } = hacer({
      candidatos: [onu('1', 'SN1', new Date(Date.now() - 10 * HORA))],
      lastInform: () => new Date(), // volvió
    });

    const r = await svc.revisar();

    expect(r.recuperadas).toBe(1);
    expect(r.rancias).toBe(0);
    expect(updates.some((u) => /tr069_stale_desde\s*=\s*NULL/i.test(u.sql))).toBe(true);
  });

  // ── Defensa 2: discriminación por dos planos ────────────────────────
  it('ONU muda pero OFFLINE en la OLT: está apagada, NO se acciona', async () => {
    // Sin este contraste, cada cliente que apaga la ONU de noche generaría una
    // re-inyección de carril al día siguiente.
    const { svc, emitidos } = hacer({
      candidatos: [onu('1', 'SN1', new Date(Date.now() - 10 * HORA))],
      lastInform: () => new Date(Date.now() - 10 * HORA),
      online: false,
    });

    const r = await svc.revisar();

    expect(r.apagadas).toBe(1);
    expect(r.accionadas).toBe(0);
    expect(emitidos.filter((e) => e.evento === 'ftth.carril.activar')).toHaveLength(0);
  });

  it('ONU muda pero ONLINE en la OLT: gestión muerta → re-inyecta el carril', async () => {
    // El caso objetivo: factory reset por botón físico. Plano de datos vivo, gestión no.
    const { svc, emitidos } = hacer({
      candidatos: [onu('1', 'SN1', new Date(Date.now() - 10 * HORA))],
      lastInform: () => new Date(Date.now() - 10 * HORA),
      online: true,
    });

    const r = await svc.revisar();

    expect(r.accionadas).toBe(1);
    const activar = emitidos.filter((e) => e.evento === 'ftth.carril.activar');
    expect(activar).toHaveLength(1);
    expect(activar[0].payload.contratoId).toBe('c-1');
  });

  it('si la OLT no responde NO se decide nada: un diagnóstico incompleto no acciona', async () => {
    const { svc, emitidos } = hacer({
      candidatos: [onu('1', 'SN1', new Date(Date.now() - 10 * HORA))],
      lastInform: () => new Date(Date.now() - 10 * HORA),
      pollFalla: true,
    });

    const r = await svc.revisar();

    expect(r.accionadas).toBe(0);
    expect(r.apagadas).toBe(0);
    expect(emitidos.filter((e) => e.evento === 'ftth.carril.activar')).toHaveLength(0);
  });

  it('no limpia la marca al accionar: solo un Inform fresco prueba que sirvió', async () => {
    // Marcarla como resuelta al re-inyectar sería dar por materializado lo aceptado.
    const { svc, updates } = hacer({
      candidatos: [onu('1', 'SN1', new Date(Date.now() - 10 * HORA))],
      lastInform: () => new Date(Date.now() - 10 * HORA),
      online: true,
    });

    await svc.revisar();

    expect(updates.some((u) => /tr069_stale_desde\s*=\s*NULL/i.test(u.sql))).toBe(false);
  });

  // ── Defensa 3: supresión zonal ──────────────────────────────────────
  it('corte zonal (>30% rancias en una OLT): se abstiene por completo', async () => {
    // 4 de 5 rancias. No son 4 averías simultáneas: es el nodo. Accionar sería
    // convertir una avería en una caída del MA5800 (pocas VTY concurrentes).
    const viejo = new Date(Date.now() - 10 * HORA);
    const { svc, emitidos } = hacer({
      candidatos: [
        onu('1', 'SN1', viejo), onu('2', 'SN2', viejo),
        onu('3', 'SN3', viejo), onu('4', 'SN4', viejo),
        onu('5', 'SN5', null),
      ],
      lastInform: (sn) => (sn === 'SN5' ? new Date() : viejo),
      online: true,
    });

    const r = await svc.revisar();

    expect(r.rancias).toBe(4);
    expect(r.accionadas).toBe(0);
    expect(r.suprimidasZonal).toBe(4);
    expect(emitidos.some((e) => e.evento === 'tr069.staleness.corte_zonal')).toBe(true);
    expect(emitidos.filter((e) => e.evento === 'ftth.carril.activar')).toHaveLength(0);
  });

  it('una sola ONU rancia NO es corte zonal aunque sea el 100% de una OLT chica', async () => {
    // La supresión exige más de una: si no, una OLT con un solo cliente nunca se repararía.
    const viejo = new Date(Date.now() - 10 * HORA);
    const { svc } = hacer({
      candidatos: [onu('1', 'SN1', viejo)],
      lastInform: () => viejo,
      online: true,
    });

    const r = await svc.revisar();

    expect(r.suprimidasZonal).toBe(0);
    expect(r.accionadas).toBe(1);
  });

  it('techo por corrida: nunca acciona más de 5 ONUs de golpe', async () => {
    const viejo = new Date(Date.now() - 10 * HORA);
    // 8 rancias sobre 40 candidatas = 20%, por debajo del umbral zonal.
    const candidatos = [
      ...Array.from({ length: 8 },  (_, i) => onu(`r${i}`, `SNR${i}`, viejo)),
      ...Array.from({ length: 32 }, (_, i) => onu(`ok${i}`, `SNOK${i}`, null)),
    ];
    const { svc, emitidos } = hacer({
      candidatos,
      lastInform: (sn) => (sn.startsWith('SNR') ? viejo : new Date()),
      online: true,
    });

    const r = await svc.revisar();

    expect(r.rancias).toBe(8);
    expect(r.accionadas).toBe(5);
    expect(emitidos.filter((e) => e.evento === 'ftth.carril.activar')).toHaveLength(5);
  });
});
