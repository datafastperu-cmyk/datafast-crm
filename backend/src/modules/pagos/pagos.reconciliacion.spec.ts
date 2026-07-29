import { PagosService } from './pagos.service';

// Un pago cobrado que no llega a surtir efecto deja al abonado CORTADO habiendo pagado, y
// hasta 2026-07-29 eso era invisible: `aplicarPagoAFacturaYContrato` no era transaccional y
// su catch solo logueaba ("no fallar — el pago ya quedó registrado"). Ningún proceso lo
// recogía: el ReconciliadorService compara el ERP contra el hardware, así que confirmaba que
// el corte estaba BIEN aplicado — reafirmaba el error en vez de corregirlo. Se descubría
// cuando el cliente reclamaba.
//
// Estos tests fijan las dos defensas. Si alguna cae, el ERP vuelve a poder cobrar sin dar
// servicio y sin que nadie se entere.
describe('PagosService — reconciliación del cobro', () => {
  const hacer = (opts: {
    pendientes?: any[];
    cortadosSinDeuda?: any[];
  } = {}) => {
    const queries: string[] = [];
    const ds = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        if (/FROM\s+pagos/i.test(sql))     return opts.pendientes ?? [];
        if (/FROM\s+contratos/i.test(sql)) return opts.cortadosSinDeuda ?? [];
        return [];
      }),
      getRepository: () => ({
        findOne: jest.fn(async ({ where }: any) => ({ id: where.id, empresaId: 'e-1' })),
      }),
    };

    const svc = Object.create(PagosService.prototype) as any;
    svc.ds = ds;
    svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    svc.heartbeat = { ejecutar: jest.fn(async (_n: string, _i: number, fn: any) => fn()) };
    svc.aplicarPagoAFacturaYContrato = jest.fn(async () => undefined);
    svc.verificarYReactivarContrato  = jest.fn(async () => undefined);
    svc.pagoRepo = { update: jest.fn(async () => undefined) };

    return { svc, ds, queries };
  };

  // `RUN_CRONS` es estado GLOBAL del proceso: con --runInBand todos los specs comparten el
  // mismo `process.env`. Borrarlo a ciegas al terminar filtra el cambio a la siguiente suite
  // y produce fallos intermitentes que no se reproducen al correr el spec aislado. Se guarda
  // y se restaura el valor previo, sea cual sea.
  const conCrons = async (fn: () => Promise<void>) => {
    const previo = process.env.RUN_CRONS;
    process.env.RUN_CRONS = 'true';
    try {
      await fn();
    } finally {
      if (previo === undefined) delete process.env.RUN_CRONS;
      else process.env.RUN_CRONS = previo;
    }
  };

  it('reintenta los pagos verificados que nunca llegaron a aplicarse', async () => {
    const { svc } = hacer({ pendientes: [{ id: 'p-1' }, { id: 'p-2' }] });

    await conCrons(() => svc.reconciliarPagosNoAplicados());

    expect(svc.aplicarPagoAFacturaYContrato).toHaveBeenCalledTimes(2);
  });

  it('la cola de pendientes se define por aplicado_en NULL, no por el estado del pago', async () => {
    // `estado = 'verificado'` solo dice que el cobro se validó; lo que dice si SURTIÓ EFECTO
    // es `aplicado_en`. Confundirlos es exactamente el bug que esto corrige.
    const { svc, queries } = hacer();
    await conCrons(() => svc.reconciliarPagosNoAplicados());

    const q = queries.find((s) => /FROM\s+pagos/i.test(s))!;
    expect(q).toMatch(/aplicado_en\s+IS\s+NULL/i);
    expect(q).toMatch(/estado\s*=\s*'verificado'/i);
    // Margen para no pelear con una aplicación que está ocurriendo ahora mismo.
    expect(q).toMatch(/verificado_en\s*<\s*NOW\(\)\s*-\s*INTERVAL/i);
  });

  it('reactiva contratos cortados SIN deuda, venga el desajuste de donde venga', async () => {
    // Defensa por síntoma: un abonado sin deuda no puede estar cortado, con independencia
    // de qué camino lo dejó así (pago no aplicado, nota de crédito, ajuste manual).
    const { svc } = hacer({
      cortadosSinDeuda: [{ id: 'c-1', empresa_id: 'e-1', numero: 'CNT-2026-000001' }],
    });

    await conCrons(() => svc.reconciliarPagosNoAplicados());

    expect(svc.verificarYReactivarContrato).toHaveBeenCalledWith(
      'c-1', 'e-1', expect.objectContaining({ sub: 'sistema' }),
    );
  });

  it('la deuda se juzga por factura del contrato Y por factura unificada del cliente', async () => {
    // Una factura unificada tiene contrato_id NULL: mirar solo las del contrato daría
    // "sin deuda" a un cliente que sí debe, y le reactivaríamos el servicio gratis.
    const { svc, queries } = hacer();
    await conCrons(() => svc.reconciliarPagosNoAplicados());

    const q = queries.find((s) => /FROM\s+contratos/i.test(s))!;
    expect(q).toMatch(/f\.contrato_id\s*=\s*co\.id/i);
    expect(q).toMatch(/f\.cliente_id\s*=\s*co\.cliente_id\s+AND\s+f\.contrato_id\s+IS\s+NULL/i);
  });

  it('un pago que vuelve a fallar no detiene la reconciliación de los demás', async () => {
    const { svc } = hacer({ pendientes: [{ id: 'p-1' }, { id: 'p-2' }] });
    svc.aplicarPagoAFacturaYContrato = jest.fn(async (p: any) => {
      if (p.id === 'p-1') throw new Error('BD caída');
    });

    await conCrons(() => svc.reconciliarPagosNoAplicados());

    expect(svc.aplicarPagoAFacturaYContrato).toHaveBeenCalledTimes(2);
    expect(svc.logger.error).toHaveBeenCalled();
  });

  it('sin RUN_CRONS no hace nada: solo una instancia PM2 reconcilia', async () => {
    const { svc, ds } = hacer({ pendientes: [{ id: 'p-1' }] });
    const previo = process.env.RUN_CRONS;
    delete process.env.RUN_CRONS;

    try {
      await svc.reconciliarPagosNoAplicados();
      expect(ds.query).not.toHaveBeenCalled();
    } finally {
      if (previo !== undefined) process.env.RUN_CRONS = previo;
    }
  });
});
