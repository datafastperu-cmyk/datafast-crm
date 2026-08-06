import { AplicadorFacturaService } from './aplicador-factura.service';

// El movimiento del saldo de un comprobante, ahora en un solo sitio.
//
// Estos casos vivían en `facturacion.service.spec.ts` y se mudan aquí con el UPDATE que
// ejercitan. No es reorganización: es que había CUATRO copias de este SQL y solo una
// estaba cubierta por tests. La de `adelantos`, sin cobertura, había perdido el guard de
// estado y aplicaba saldo a favor contra comprobantes ANULADOS.
//
// El driver de Postgres devuelve `[filas, rowCount]` en un `UPDATE ... RETURNING`, así que
// el mock IMITA ESA FORMA: un mock más cómodo dejaría pasar justo la clase de bug que ya
// costó un outbox sin drenar.
describe('AplicadorFacturaService — el único escritor del saldo', () => {
  const hacer = () => {
    const query = jest.fn();
    const svc = new AplicadorFacturaService({
      query,
      manager: { query },
    } as any);
    return { svc, query };
  };

  const updateDevuelve = (query: jest.Mock, filas: any[]) =>
    query.mockResolvedValueOnce([filas, filas.length]);

  it('el estado lo decide el SQL, no el código', async () => {
    const { svc, query } = hacer();
    updateDevuelve(query, [{ id: 'fac-001', estado: 'pagada' }]);

    const r = await svc.aplicar('fac-001', 85, 'emp-001', '2024-01-20');

    expect(r.estado).toBe('pagada');
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/UPDATE\s+facturas/i);
    // Calcular el estado en memoria reabre la race de leer-calcular-escribir.
    expect(sql).toMatch(/estado\s*=\s*CASE/i);
  });

  it('rechaza aplicar a una factura anulada — el guard que la copia de adelantos perdió', async () => {
    const { svc, query } = hacer();
    updateDevuelve(query, []);              // el WHERE no dejó pasar nada
    query.mockResolvedValueOnce([{ estado: 'anulada', total: '85', pagado: '0' }]);

    await expect(svc.aplicar('fac-001', 85, 'emp-001', '2024-01-20'))
      .rejects.toThrow(/anulada/i);

    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/estado NOT IN \('pagada', 'anulada'\)/i);
  });

  it('una factura ya pagada se rechaza con su motivo, no con un fallo genérico', async () => {
    const { svc, query } = hacer();
    updateDevuelve(query, []);
    query.mockResolvedValueOnce([{ estado: 'pagada', total: '85', pagado: '85' }]);

    await expect(svc.aplicar('fac-001', 85, 'emp-001', '2024-01-20'))
      .rejects.toThrow(/ya está completamente pagada/i);
  });

  it('rechaza el sobrepago con el saldo REAL: dos cajeros cobrando a la vez', async () => {
    // El segundo tiene que recibir un rechazo que explique cuánto queda, no un sobrepago
    // silencioso. La condición vive en el WHERE justamente para que no haya ventana entre
    // consultar el saldo y escribirlo.
    const { svc, query } = hacer();
    updateDevuelve(query, []);
    query.mockResolvedValueOnce([{ estado: 'pagada_parcial', total: '85', pagado: '80' }]);

    await expect(svc.aplicar('fac-001', 50, 'emp-001', '2024-01-20'))
      .rejects.toThrow(/excede el saldo pendiente S\/ 5\.00/i);

    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/<=\s*\(total::numeric\s*-\s*monto_pagado::numeric\s*\+\s*0\.01\)/);
  });

  it('con `manager` escribe DENTRO de la transacción del llamante', async () => {
    // Es lo que permite que el volcado y lo que el llamante haga con él —marcar la
    // imputación, registrar el pago— se confirmen o se deshagan juntos.
    const { svc, query } = hacer();
    const managerQuery = jest.fn().mockResolvedValueOnce([[{ id: 'f', estado: 'pagada' }], 1]);

    await svc.aplicar('fac-001', 85, 'emp-001', '2024-01-20', { query: managerQuery } as any);

    expect(managerQuery).toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});
