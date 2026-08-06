import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { PagosService } from './pagos.service';
import { EstadoPago, MotivoExtorno } from './entities/pago.entity';

// Extorno de pagos (F4, 2026-08-06).
//
// Es el flujo con más potencial de daño del módulo: un extorno mal hecho corta a un
// abonado que pagó, o deja pagada una factura que nunca se cobró. Antes de F4 lo que
// había era `eliminar()`, que BORRABA la fila del pago y restaba a ojo sobre la factura.
//
// Los dos defectos que eso tenía, y que estos tests fijan como corregidos:
//   · Borrar el pago perdía el único rastro de que ese dinero existió.
//   · Restar en vez de recalcular descuadra en cuanto una reversión se interrumpe y se
//     reintenta — que es justo cuando importa.
describe('PagosService — extorno', () => {
  const pagoBase = {
    id: 'p-1', empresaId: 'e-1', clienteId: 'cli-1', monto: 128,
    metodoPago: 'Efectivo', estado: EstadoPago.VERIFICADO,
    conciliado: false, notas: null,
  };

  const hacer = (over: Partial<typeof pagoBase> = {}, aplicaciones: any[] = [
    { factura_id: 'f-1', monto_aplicado: '64.00' },
    { factura_id: 'f-2', monto_aplicado: '64.00' },
  ]) => {
    const pago = { ...pagoBase, ...over };
    const sqls: string[] = [];
    const managerMock = {
      query:  jest.fn(async (sql: string, _params?: unknown[]) => { sqls.push(sql); return []; }),
      update: jest.fn(),
    };
    const svc = Object.create(PagosService.prototype) as any;
    svc.ds = {
      query: jest.fn(async () => aplicaciones),
      transaction: jest.fn(async (fn: any) => fn(managerMock)),
    };
    svc.logger    = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    svc.aplicador = { revertir: jest.fn(async () => ({ estado: 'vencida', montoPagado: 0 })) };
    svc.auditoria = { logUpdate: jest.fn() };
    svc.deudaSvc  = { recalcularPorCliente: jest.fn().mockResolvedValue(undefined) };
    svc.findOne   = jest.fn(async () => pago);
    return { svc, managerMock, sqls, pago };
  };

  const user = { sub: 'u-1', email: 'cajero@erp', empresaId: 'e-1', roles: ['Cajero'], permisos: [] } as any;
  const dto  = { motivo: MotivoExtorno.ERROR_REGISTRO } as any;

  it('NO borra el pago: lo marca extornado y conserva la fila', async () => {
    const { svc, managerMock } = hacer();

    await svc.extornar('p-1', dto, user);

    expect(managerMock.update).toHaveBeenCalledWith(
      expect.anything(), 'p-1',
      expect.objectContaining({ estado: EstadoPago.EXTORNADO }),
    );
    // Ni un DELETE del pago. Un pago registrado es un hecho histórico.
    expect(managerMock.query.mock.calls.some(([s]: [string]) => /DELETE FROM pagos\b/i.test(s)))
      .toBe(false);
  });

  it('recalcula el saldo en vez de restar — reintentar un extorno da el mismo resultado', async () => {
    // El defecto de `eliminar()`: restaba `pago.monto`. Correcto la primera vez, y
    // descuadrado la segunda. Ahora se retiran las imputaciones y el aplicador reconstruye
    // `monto_pagado` desde lo que queda vivo.
    const { svc, sqls } = hacer();

    await svc.extornar('p-1', dto, user);

    expect(sqls.some((s) => /DELETE FROM pago_aplicaciones/i.test(s))).toBe(true);
    expect(svc.aplicador.revertir).toHaveBeenCalledTimes(2);   // f-1 y f-2
    expect(svc.aplicador.revertir).toHaveBeenCalledWith('f-1', 'e-1', expect.anything());
  });

  it('la bitácora se escribe ANTES de tocar nada', async () => {
    // Si el proceso muere a mitad, tiene que quedar constancia de qué se intentó y de qué
    // había. Al revés, un extorno interrumpido sería invisible.
    const { svc, sqls } = hacer();

    await svc.extornar('p-1', dto, user);

    const iBitacora = sqls.findIndex((s) => /INSERT INTO pago_extorno/i.test(s));
    const iBorrado  = sqls.findIndex((s) => /DELETE FROM pago_aplicaciones/i.test(s));
    expect(iBitacora).toBeGreaterThanOrEqual(0);
    expect(iBitacora).toBeLessThan(iBorrado);
  });

  it('guarda qué comprobantes se vieron afectados y por cuánto', async () => {
    // La fila del pago sobrevive pero cambia de estado: sin esto, dentro de un año nadie
    // puede reconstruir qué se deshizo exactamente.
    const { svc, managerMock } = hacer();

    await svc.extornar('p-1', dto, user);

    const llamada = managerMock.query.mock.calls
      .find((c: any[]) => /INSERT INTO pago_extorno/i.test(String(c[0])))!;
    const params = llamada[1] as unknown[];
    expect(JSON.parse(String(params[5]))).toEqual([
      { facturaId: 'f-1', monto: 64 },
      { facturaId: 'f-2', monto: 64 },
    ]);
  });

  it('NO corta el servicio: la deuda vuelve y el corte lo decide el ciclo de cobranza', async () => {
    // El motivo más frecuente de extorno es `error_registro` — una equivocación NUESTRA.
    // Cortar al abonado en el mismo request significaría que el ERP corta clientes por
    // errores propios, en segundos, sin que nadie lo revise.
    const { svc } = hacer();

    await svc.extornar('p-1', dto, user);

    expect(svc.deudaSvc.recalcularPorCliente).toHaveBeenCalledWith('cli-1', 'e-1');
    // No hay llamada a suspender/cortar por ninguna vía.
    expect(svc.logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/periodo de gracia/),
    );
  });

  it('extornar dos veces no revierte el dinero dos veces', async () => {
    const { svc } = hacer({ estado: EstadoPago.EXTORNADO });

    await expect(svc.extornar('p-1', dto, user)).rejects.toThrow(BadRequestException);
    expect(svc.aplicador.revertir).not.toHaveBeenCalled();
  });

  describe('pago ya conciliado con el extracto bancario', () => {
    it('un cajero sin permiso no puede romper un cierre contable', async () => {
      const { svc } = hacer({ conciliado: true });
      await expect(svc.extornar('p-1', dto, user)).rejects.toThrow(ForbiddenException);
    });

    it('con permiso sí, pero la nota es obligatoria', async () => {
      const supervisor = { ...user, roles: ['Administrador'] };
      const { svc } = hacer({ conciliado: true });

      await expect(svc.extornar('p-1', dto, supervisor)).rejects.toThrow(/nota/i);

      const conNota = hacer({ conciliado: true });
      await conNota.svc.extornar('p-1', { ...dto, nota: 'Contracargo Visa 4512' }, supervisor);
      expect(conNota.svc.aplicador.revertir).toHaveBeenCalled();
    });
  });

  it('`eliminar` ya no borra: redirige al extorno explicando por qué', async () => {
    const svc = Object.create(PagosService.prototype) as any;
    await expect(svc.eliminar('p-1', 'e-1', user)).rejects.toThrow(/se extorna/i);
  });
});
