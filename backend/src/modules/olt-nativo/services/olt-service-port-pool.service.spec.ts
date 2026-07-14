import { OltServicePortPoolService } from './olt-service-port-pool.service';

// Extrae la última llamada a ds.query como { sql, params }.
function lastQuery(ds: any) {
  const call = ds.query.mock.calls[ds.query.mock.calls.length - 1];
  return { sql: call[0] as string, params: call[1] as any[] };
}

describe('OltServicePortPoolService — canal (Inc.4)', () => {
  let ds: any;
  let svc: OltServicePortPoolService;

  beforeEach(() => {
    ds = { query: jest.fn() };
    const oltRepo: any = { findOne: jest.fn() };
    const automation: any = { servicePorts: jest.fn() };
    svc = new OltServicePortPoolService(ds, oltRepo, automation, {} as never);
  });

  describe('configurarRango', () => {
    it('default canal="datos" e inserta con ON CONFLICT (olt_id, canal, service_port_id)', async () => {
      ds.query.mockResolvedValue([{ service_port_id: 10 }, { service_port_id: 11 }]);
      await svc.configurarRango('olt1', 'e1', { inicio: 10, fin: 11 });
      const { sql, params } = lastQuery(ds);
      expect(sql).toContain('ON CONFLICT (olt_id, canal, service_port_id)');
      expect(params).toEqual(['e1', 'olt1', [10, 11], 'datos']);
    });

    it('canal="gestion" se propaga como parámetro', async () => {
      ds.query.mockResolvedValue([]);
      await svc.configurarRango('olt1', 'e1', { inicio: 100, fin: 100 }, 'gestion');
      expect(lastQuery(ds).params).toEqual(['e1', 'olt1', [100], 'gestion']);
    });
  });

  describe('allocar', () => {
    it('asigna del canal indicado (reuse) filtrando por canal', async () => {
      ds.query.mockResolvedValueOnce([{ service_port_id: 200 }]); // reuse hit
      const r = await svc.allocar('olt1', 'c1', 'gestion');
      expect(r).toBe(200);
      const { sql, params } = lastQuery(ds);
      expect(sql).toContain('canal');
      expect(params).toEqual(['olt1', 'c1', 'gestion']);
    });

    it('sin reuse: UPDATE atómico incluye el canal en el subquery', async () => {
      ds.query
        .mockResolvedValueOnce([])                              // sin reuse
        .mockResolvedValueOnce([[{ service_port_id: 5 }], 1]);  // UPDATE ... RETURNING
      const r = await svc.allocar('olt1', 'c1', 'gestion');
      expect(r).toBe(5);
      const { sql, params } = lastQuery(ds);
      expect(sql).toContain('FOR UPDATE SKIP LOCKED');
      expect(params).toEqual(['c1', 'olt1', 'gestion']);
    });

    it('pool del canal vacío → null (modo bypass)', async () => {
      ds.query
        .mockResolvedValueOnce([])            // sin reuse
        .mockResolvedValueOnce([[], 0])       // UPDATE no asigna
        .mockResolvedValueOnce([{ total: '0' }]); // count del canal = 0
      const r = await svc.allocar('olt1', 'c1', 'gestion');
      expect(r).toBeNull();
      expect(lastQuery(ds).params).toEqual(['olt1', 'gestion']);
    });

    it('pool configurado pero agotado → lanza', async () => {
      ds.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([[], 0])
        .mockResolvedValueOnce([{ total: '50' }]);
      await expect(svc.allocar('olt1', 'c1', 'gestion')).rejects.toThrow(/agotado/i);
    });
  });

  describe('liberar / obtenerEstado', () => {
    it('liberar filtra por canal', async () => {
      ds.query.mockResolvedValue([]);
      await svc.liberar('olt1', 'c1', 'gestion');
      expect(lastQuery(ds).params).toEqual(['olt1', 'c1', 'gestion']);
    });

    it('obtenerEstado agrega por canal', async () => {
      ds.query.mockResolvedValue([{ total: '5', libres: '4', ocupados: '1', min_id: 100, max_id: 104 }]);
      const est = await svc.obtenerEstado('olt1', 'e1', 'gestion');
      expect(est).toEqual({ total: 5, libres: 4, ocupados: 1, rango: { min: 100, max: 104 } });
      expect(lastQuery(ds).params).toEqual(['olt1', 'e1', 'gestion']);
    });
  });
});
