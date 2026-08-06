import { CanalPagoService } from './canal-pago.service';
import { CanalPago, FormaPago } from './entities/canal-pago.entity';

// Los tres ejes de un ingreso (forma / canal / cuenta receptora) nacen de lo que el
// diagnóstico F0 midió sobre los dos únicos pagos que existían en producción:
//
//   · `metodo_pago = 'Efectivo'` capitalizado — el formulario de finanzas mandaba el
//     rótulo del catálogo `formas_pago_isp`, no el valor del enum de dominio. Como la
//     columna es `varchar(100)` libre, cualquier cosa cabía.
//   · Un pago en EFECTIVO con `banco = 'Banco 01'`, porque ese mismo formulario
//     autoselecciona el primer banco de la lista y lo envía siempre.
//   · Ni un solo pago sabía en qué cuenta entró el dinero.
//
// Mientras convivan los dos formularios (hasta F5), el backend traduce. Estos tests fijan
// esa traducción: si cae, los pagos vuelven a nacer sin clasificar y desaparecen de todo
// reporte de tesorería sin que nadie lo note.
describe('CanalPagoService — los tres ejes del ingreso (F1)', () => {
  const canal = (over: Partial<CanalPago> = {}): CanalPago => ({
    id: 'c-1', empresaId: 'e-1', codigo: 'oficina', nombre: 'Oficina',
    formaPago: FormaPago.EFECTIVO, cuentaReceptoraDefaultId: 'caja-1',
    requiereNumeroOperacion: false, requiereVoucher: false,
    comisionPorcentaje: 0, comisionFija: 0,
    permiteRegistroManual: true, activo: true, esProtegido: true,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  } as CanalPago);

  const hacer = (encontrado: CanalPago | null, porNombre: CanalPago | null = null) => {
    const repo = {
      findOne: jest.fn(async () => encontrado),
      find:    jest.fn(async () => []),
      createQueryBuilder: () => ({
        where: function () { return this; },
        andWhere: function () { return this; },
        getOne: async () => porNombre,
      }),
    };
    const svc = new CanalPagoService({ manager: { getRepository: () => repo } } as any);
    (svc as any).logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };
    return { svc, repo };
  };

  describe('compatibilidad con los formularios vivos', () => {
    it("traduce 'Efectivo' capitalizado — el rótulo que mandaba finanzas/registro (F0)", async () => {
      const { svc, repo } = hacer(canal());
      const r = await svc.resolverDesdeLegacy('e-1', 'Efectivo', null);

      expect(r?.codigo).toBe('oficina');
      // La comparación es case-insensitive por diseño: la columna libre admitió durante
      // meses el rótulo y el valor de dominio indistintamente.
      expect(repo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ codigo: 'oficina' }) }),
      );
    });

    it("traduce 'efectivo' en minúscula — el valor que manda RegistrarPagoForm", async () => {
      const { svc } = hacer(canal());
      expect((await svc.resolverDesdeLegacy('e-1', 'efectivo', null))?.codigo).toBe('oficina');
    });

    it('ignora el banco cuando la forma no lo usa (el pago en efectivo con "Banco 01")', async () => {
      // El formulario envía banco SIEMPRE porque autoselecciona el primero de la lista.
      // Un canal de efectivo no puede depender de eso: si dependiera, el mismo cobro en
      // efectivo caería en canales distintos según lo que hubiera preseleccionado la UI.
      const { svc } = hacer(canal());
      const r = await svc.resolverDesdeLegacy('e-1', 'Efectivo', 'Banco 01');
      expect(r?.codigo).toBe('oficina');
    });

    it('yape y plin son CANALES de la forma billetera, no formas', async () => {
      // En el enum antiguo `yape` convivía con `transferencia_bancaria`, que es un nivel
      // distinto. Esa mezcla es la que hacía imposible preguntar "cuánto entró por
      // billetera" sin enumerar a mano cada aplicación.
      const { svc } = hacer(canal({ codigo: 'yape', formaPago: FormaPago.BILLETERA }));
      const r = await svc.resolverDesdeLegacy('e-1', 'yape', null);
      expect(r?.formaPago).toBe(FormaPago.BILLETERA);
    });

    it('una transferencia elige canal por el banco escrito a mano', async () => {
      const bcp = canal({ codigo: 'transferencia-bcp', nombre: 'BCP', formaPago: FormaPago.TRANSFERENCIA });
      const { svc } = hacer(null, bcp);
      const r = await svc.resolverDesdeLegacy('e-1', 'transferencia_bancaria', 'BCP');
      expect(r?.codigo).toBe('transferencia-bcp');
    });

    it('un método desconocido NO rompe el cobro: avisa y deja el pago sin clasificar', async () => {
      // Rechazar el cobro porque el ERP no supo etiquetarlo sería peor que registrarlo sin
      // etiqueta: el abonado se queda sin poder pagar por un problema de catálogo.
      const { svc } = hacer(null, null);
      const r = await svc.resolverDesdeLegacy('e-1', 'cripto', null);

      expect(r).toBeNull();
      expect((svc as any).logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/sin canal equivalente/),
      );
    });
  });

  describe('comisión: el bruto salda la factura, el neto se busca en el extracto', () => {
    it('descuenta porcentaje y fija sin tocar el importe que salda la factura', async () => {
      const { svc } = hacer(null);
      const c = canal({ comisionPorcentaje: 3.5, comisionFija: 0.5 });

      const { comision, neto } = svc.calcularComision(c, 100);

      expect(comision).toBe(4);   // 3.50 + 0.50
      expect(neto).toBe(96);
    });

    it('sin canal no inventa comisión', async () => {
      const { svc } = hacer(null);
      expect(svc.calcularComision(null, 85)).toEqual({ comision: 0, neto: 85 });
    });

    it('una comisión mayor que el cobro es error de configuración, no un neto negativo', async () => {
      // Un neto negativo se propagaría a la conciliación y al asiento de gasto, y nadie
      // lo miraría hasta el cierre. Mejor registrar 0 y gritar en el log.
      const { svc } = hacer(null);
      const c = canal({ comisionFija: 200 });

      expect(svc.calcularComision(c, 85)).toEqual({ comision: 0, neto: 85 });
      expect((svc as any).logger.error).toHaveBeenCalledWith(
        expect.stringMatching(/supera el importe cobrado/),
      );
    });
  });

  describe('canal desactivado', () => {
    it('no se puede cobrar por un canal dado de baja, pero el histórico lo conserva', async () => {
      // La baja es LÓGICA: retira el canal de los selectores, nunca del histórico. Un pago
      // de hace dos años tiene que seguir diciendo por dónde entró.
      const { svc } = hacer(canal({ activo: false, nombre: 'Plin' }));
      await expect(svc.porId('c-1', 'e-1')).rejects.toThrow(/desactivado/);
    });
  });
});
