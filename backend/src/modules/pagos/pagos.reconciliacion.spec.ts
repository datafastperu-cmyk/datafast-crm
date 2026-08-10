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
        if (/FROM\s+servicios/i.test(sql)) return opts.cortadosSinDeuda ?? [];
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
    svc.aplicador = { aplicar: jest.fn(), divergencias: jest.fn(async () => []) };
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
    // Una factura unificada tiene servicio_id NULL: mirar solo las del contrato daría
    // "sin deuda" a un cliente que sí debe, y le reactivaríamos el servicio gratis.
    const { svc, queries } = hacer();
    await conCrons(() => svc.reconciliarPagosNoAplicados());

    const q = queries.find((s) => /FROM\s+servicios/i.test(s))!;
    expect(q).toMatch(/f\.servicio_id\s*=\s*co\.id/i);
    expect(q).toMatch(/f\.cliente_id\s*=\s*co\.cliente_id\s+AND\s+f\.servicio_id\s+IS\s+NULL/i);
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

  // ─────────────────────────────────────────────────────────────────────────
  // Bucle de reintentos sobre pagos YA aplicados (F0, 2026-08-06)
  //
  // Medido en producción: `pagos-reconciliacion` acumulaba 1123 ejecuciones reintentando
  // cada 10 minutos DOS pagos cuyas facturas ya estaban saldadas. `aplicarPago` respondía
  // "La factura ya está completamente pagada", el catch se lo tragaba, `aplicado_en` seguía
  // NULL y volvía a empezar. Mismo patrón que los 1788 reintentos contra el MA5800.
  //
  // Dos causas encadenadas, y cada una ocultaba a la otra:
  //  · `registrar()` aplicaba el dinero sin marcar `aplicado_en` (el 100% de los pagos
  //    nacía en la cola de pendientes).
  //  · reaplicar no era idempotente, así que nunca salían de esa cola.
  // ─────────────────────────────────────────────────────────────────────────
  describe('un pago ya aplicado no se reaplica (bucle de 1123 pasadas, F0 06/08)', () => {
    const conAplicaciones = (filas: any[]) => {
      const facturacionSvc = { aplicarPago: jest.fn(async () => ({})) };
      const marcadas: string[] = [];
      const ds = {
        query: jest.fn(async (sql: string) => {
          if (/COUNT\(\*\)/i.test(sql))                    return [{ total: String(filas.length) }];
          if (/FROM pago_aplicaciones/i.test(sql))         return filas.filter((f) => !f.aplicado_en);
          return [];
        }),
        transaction: jest.fn(async (fn: any) => fn({
          query: jest.fn(async (sql: string, params: any[]) => {
            if (/UPDATE pago_aplicaciones/i.test(sql)) marcadas.push(params[0]);
            return [];
          }),
        })),
      };
      const svc = Object.create(PagosService.prototype) as any;
      svc.ds = ds;
      svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
      svc.facturacionSvc = facturacionSvc;
      svc.aplicador = { aplicar: facturacionSvc.aplicarPago, divergencias: jest.fn(async () => []) };
      svc.pagoRepo = { update: jest.fn(async () => undefined) };
      svc.verificarYReactivarContrato = jest.fn(async () => undefined);
      return { svc, facturacionSvc, marcadas };
    };

    const pago = { id: 'p-1', empresaId: 'e-1', facturaId: 'f-1', fechaPago: '2026-08-06', monto: 128, reactivarServicio: false } as any;

    it('con todas las imputaciones marcadas NO toca la factura, y aun así marca el pago', async () => {
      const { svc, facturacionSvc } = conAplicaciones([
        { id: 'a-1', factura_id: 'f-1', monto_aplicado: '64.00', aplicado_en: new Date() },
        { id: 'a-2', factura_id: 'f-2', monto_aplicado: '64.00', aplicado_en: new Date() },
      ]);

      await svc.aplicarPagoAFacturaYContrato(pago, { sub: 'sistema' });

      // Cero llamadas: es lo que rompe el bucle. Antes se llamaba siempre y siempre fallaba.
      expect(facturacionSvc.aplicarPago).not.toHaveBeenCalled();
      // Y el pago SALE de la cola: reintentar algo ya hecho es ÉXITO (`ya_en_destino`).
      expect(svc.pagoRepo.update).toHaveBeenCalledWith('p-1', expect.objectContaining({
        aplicadoEn: expect.any(Date),
      }));
    });

    it('aplica solo las imputaciones pendientes de un consolidado a medias', async () => {
      const { svc, facturacionSvc, marcadas } = conAplicaciones([
        { id: 'a-1', factura_id: 'f-1', monto_aplicado: '64.00', aplicado_en: new Date() },
        { id: 'a-2', factura_id: 'f-2', monto_aplicado: '64.00', aplicado_en: null },
      ]);

      await svc.aplicarPagoAFacturaYContrato(pago, { sub: 'sistema' });

      expect(facturacionSvc.aplicarPago).toHaveBeenCalledTimes(1);
      expect(facturacionSvc.aplicarPago).toHaveBeenCalledWith(
        'f-2', 64, 'e-1', '2026-08-06', expect.anything(),
      );
      expect(marcadas).toEqual(['a-2']);
    });

    it('el volcado y su marca van en la MISMA transacción', async () => {
      // Separarlos reabre el bucle por otra puerta: una caída entre ambos deja el dinero
      // aplicado y la imputación sin marcar, y el siguiente reintento lo cuenta dos veces.
      const { svc } = conAplicaciones([
        { id: 'a-1', factura_id: 'f-1', monto_aplicado: '64.00', aplicado_en: null },
      ]);

      await svc.aplicarPagoAFacturaYContrato(pago, { sub: 'sistema' });

      expect(svc.ds.transaction).toHaveBeenCalledTimes(1);
      // El manager de esa TX es el que recibe `aplicarPago` — no una conexión suelta.
      expect(svc.facturacionSvc.aplicarPago.mock.calls[0][4]).toBeDefined();
    });

    it('un pago anterior a pago_aplicaciones sigue aplicándose entero a su factura', async () => {
      // Sin NINGUNA imputación registrada es histórico previo a la tabla. Se distingue de
      // "todas ya aplicadas" por el total, no por las pendientes: confundirlos reaplicaría
      // entero un pago ya volcado.
      const { svc, facturacionSvc } = conAplicaciones([]);

      await svc.aplicarPagoAFacturaYContrato(pago, { sub: 'sistema' });

      expect(facturacionSvc.aplicarPago).toHaveBeenCalledWith(
        'f-1', 128, 'e-1', '2026-08-06', expect.anything(),
      );
    });
  });

  it('el log de la reconciliación describe lo ocurrido, no lo intentado (F0 06/08)', async () => {
    // Producción tenía, con el mismo timestamp, el error "queda PENDIENTE de aplicar" y el
    // éxito "aplicado por reconciliación" del mismo pago. El segundo se emitía sin mirar
    // nada: bastaba con que el catch interno no relanzara.
    const { svc, ds } = hacer({ pendientes: [{ id: 'p-1' }] });
    ds.query = jest.fn(async (sql: string) => {
      if (/SELECT aplicado_en FROM pagos/i.test(sql)) return [{ aplicado_en: null }];
      if (/FROM\s+pagos/i.test(sql))                  return [{ id: 'p-1' }];
      return [];
    }) as any;

    await conCrons(() => svc.reconciliarPagosNoAplicados());

    expect(svc.logger.warn).not.toHaveBeenCalledWith(expect.stringMatching(/aplicado por reconciliación/));
    expect(svc.logger.error).toHaveBeenCalledWith(expect.stringMatching(/sigue SIN aplicarse/));
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
