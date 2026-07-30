import { DataSource } from 'typeorm';

import { DeudaPorContratoService } from './deuda-por-contrato.service';

// El comprobante es CONSOLIDADO por cliente: un abonado con dos servicios recibe uno
// solo, con contrato_id en null. Sin imputar esa deuda a cada contrato:
//   · el portal mostraba "Deuda actual S/ 0.00" a quien debía S/ 64;
//   · el corte automático por morosidad, que decide POR CONTRATO, no sabe a quién cortar.
//
// Estos casos fijan cómo se reparte. La regla es proporcional al peso de las líneas de
// cada contrato: si el abonado paga la mitad de un consolidado, cada servicio queda a la
// mitad. No se puede saber "cuál" pagó, y suponerlo sería inventar una imputación.

const CLIENTE = 'cli-1';
const EMPRESA = 'emp-1';
const A = 'contrato-A';
const B = 'contrato-B';

function servicioCon(facturas: Array<Record<string, unknown>>) {
  const ds = {
    query: jest.fn((sql: string) => {
      if (sql.includes('FROM facturas')) return Promise.resolve(facturas);
      return Promise.resolve([]);
    }),
  } as unknown as DataSource;
  return new DeudaPorContratoService(ds);
}

const linea = (contratoId: string | null, total: number) => ({
  descripcion: 'Plan', cantidad: 1, precioUnitario: total, subtotal: total, total,
  ...(contratoId ? { contratoId } : {}),
});

describe('DeudaPorContratoService', () => {
  it('factura atada a un contrato: se imputa entera a ese contrato', async () => {
    const svc = servicioCon([
      { id: 'f1', total: '64.00', saldo: '64.00', monto_pagado: '0', contrato_id: A, items: [] },
    ]);

    const deudas = await svc.calcular(CLIENTE, EMPRESA);

    expect(deudas.get(A)).toEqual({ monto: 64, comprobantes: 1 });
    expect(deudas.has(B)).toBe(false);
  });

  it('consolidada sin pagos: cada contrato recibe el importe de sus lineas', async () => {
    const svc = servicioCon([
      {
        id: 'f1', total: '100.00', saldo: '100.00', monto_pagado: '0', contrato_id: null,
        items: [linea(A, 64), linea(B, 36)],
      },
    ]);

    const deudas = await svc.calcular(CLIENTE, EMPRESA);

    expect(deudas.get(A)?.monto).toBe(64);
    expect(deudas.get(B)?.monto).toBe(36);
  });

  it('consolidada pagada a medias: el saldo se reparte proporcionalmente', async () => {
    const svc = servicioCon([
      {
        id: 'f1', total: '100.00', saldo: '50.00', monto_pagado: '50.00', contrato_id: null,
        items: [linea(A, 64), linea(B, 36)],
      },
    ]);

    const deudas = await svc.calcular(CLIENTE, EMPRESA);

    expect(deudas.get(A)?.monto).toBe(32);
    expect(deudas.get(B)?.monto).toBe(18);
    // Lo repartido no puede exceder lo que realmente se debe.
    const total = (deudas.get(A)!.monto) + (deudas.get(B)!.monto);
    expect(total).toBeCloseTo(50, 2);
  });

  it('factura saldada no suma deuda', async () => {
    const svc = servicioCon([
      {
        id: 'f1', total: '100.00', saldo: '0.00', monto_pagado: '100.00', contrato_id: null,
        items: [linea(A, 64), linea(B, 36)],
      },
    ]);

    expect((await svc.calcular(CLIENTE, EMPRESA)).size).toBe(0);
  });

  it('varias facturas acumulan monto y cuentan comprobantes', async () => {
    const svc = servicioCon([
      { id: 'f1', total: '64.00', saldo: '64.00', monto_pagado: '0', contrato_id: null, items: [linea(A, 64)] },
      { id: 'f2', total: '64.00', saldo: '64.00', monto_pagado: '0', contrato_id: null, items: [linea(A, 64)] },
    ]);

    const deudas = await svc.calcular(CLIENTE, EMPRESA);

    expect(deudas.get(A)).toEqual({ monto: 128, comprobantes: 2 });
  });

  // Facturas anteriores a `contratoId` en el ítem, o compuestas solo de cargos.
  it('consolidada sin lineas atribuibles NO se reparte a ciegas', async () => {
    const svc = servicioCon([
      {
        id: 'f1', total: '100.00', saldo: '100.00', monto_pagado: '0', contrato_id: null,
        items: [linea(null, 100)],
      },
    ]);

    // Repartir a partes iguales inventaría una imputación que nadie registró.
    expect((await svc.calcular(CLIENTE, EMPRESA)).size).toBe(0);
  });

  it('items nulo o corrupto no rompe el cálculo', async () => {
    const svc = servicioCon([
      { id: 'f1', total: '50.00', saldo: '50.00', monto_pagado: '0', contrato_id: null, items: null },
      { id: 'f2', total: '50.00', saldo: '50.00', monto_pagado: '0', contrato_id: null, items: 'no-es-array' },
      { id: 'f3', total: '30.00', saldo: '30.00', monto_pagado: '0', contrato_id: null, items: [linea(B, 30)] },
    ]);

    const deudas = await svc.calcular(CLIENTE, EMPRESA);

    expect(deudas.get(B)?.monto).toBe(30);
    expect(deudas.size).toBe(1);
  });

  it('saldo nulo se deriva de total menos pagado', async () => {
    const svc = servicioCon([
      { id: 'f1', total: '80.00', saldo: null, monto_pagado: '30.00', contrato_id: A, items: [] },
    ]);

    expect((await svc.calcular(CLIENTE, EMPRESA)).get(A)?.monto).toBe(50);
  });
});
