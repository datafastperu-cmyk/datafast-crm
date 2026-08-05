import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import {
  PoliticaFacturacionService,
  PoliticaFacturacion,
} from './politica-facturacion.service';

/**
 * La invariante que motiva este módulo: al abonado NUNCA se le corta antes de que venza
 * la factura que justifica el corte.
 *
 * Incidente 2026-08-05 (James Pena): el portal le anunciaba corte el día 4 calculándolo
 * con `contratos.dias_prorroga`, su factura vencía el 6 porque se emitía con
 * `empresas.dias_gracia`, y el cron lo cortó el 5 midiendo días desde el alta del
 * contrato. Tres fechas, tres fórmulas, ninguna de acuerdo. Estos tests existen para que
 * no vuelvan a divergir en silencio.
 */
describe('PoliticaFacturacionService', () => {
  let svc: PoliticaFacturacionService;
  let query: jest.Mock;

  beforeEach(async () => {
    query = jest.fn();
    const mod = await Test.createTestingModule({
      providers: [
        PoliticaFacturacionService,
        { provide: getDataSourceToken(), useValue: { query } },
      ],
    }).compile();
    svc = mod.get(PoliticaFacturacionService);
  });

  const politica = (over: Partial<PoliticaFacturacion> = {}): PoliticaFacturacion => ({
    diaPago: 28,
    diasAntesEmision: 5,
    diasGracia: 7,
    mesesVencidosParaCorte: 1,
    origen: 'cliente',
    ...over,
  });

  describe('invariante: vencimiento < corte (incidente 05/08)', () => {
    // Se recorre todo el rango admitido de días de pago y de gracia porque el fallo
    // original solo aparecía con ciertas combinaciones: con día 1 y gracia 5 las dos
    // fórmulas viejas daban 4 y 6, y nadie las comparó nunca.
    it('el corte cae siempre después del vencimiento, para todo diaPago y toda gracia', () => {
      for (let diaPago = 1; diaPago <= 28; diaPago++) {
        for (let diasGracia = 1; diasGracia <= 25; diasGracia++) {
          const p = politica({ diaPago, diasGracia });
          const venc  = svc.proximoVencimiento(p, new Date(Date.UTC(2026, 7, 5)));
          const corte = svc.fechaCorte(p, venc)!;

          expect(corte.getTime()).toBeGreaterThan(venc.getTime());
        }
      }
    });

    it('la emisión nunca cae después del vencimiento', () => {
      for (let diasAntes = 1; diasAntes <= 25; diasAntes++) {
        const p = politica({ diasAntesEmision: diasAntes });
        const venc   = svc.proximoVencimiento(p, new Date(Date.UTC(2026, 7, 5)));
        const emite  = svc.fechaEmision(p, venc)!;

        expect(emite.getTime()).toBeLessThan(venc.getTime());
      }
    });

    it('reproduce el caso exacto de James Pena: día 28, gracia 7, emisión 5 días antes', () => {
      const p     = politica();
      const venc  = svc.proximoVencimiento(p, new Date(Date.UTC(2026, 7, 5)));
      const corte = svc.fechaCorte(p, venc)!;
      const emite = svc.fechaEmision(p, venc)!;

      expect(svc.aIso(emite)).toBe('2026-08-23');
      expect(svc.aIso(venc)).toBe('2026-08-28');
      expect(svc.aIso(corte)).toBe('2026-09-04');
    });
  });

  describe('sin corte automático', () => {
    it('gracia 0 no produce fecha de corte — la UI lo ofrece como "0 Días"', () => {
      expect(svc.fechaCorte(politica({ diasGracia: 0 }), new Date())).toBeNull();
    });

    it('sin días de emisión no hay emisión automática — es "Desactivado"', () => {
      expect(svc.fechaEmision(politica({ diasAntesEmision: null }), new Date())).toBeNull();
    });
  });

  describe('resolución de la configuración', () => {
    it('lee la del cliente cuando tiene diaPago propio', async () => {
      query.mockResolvedValue([{
        facturacion_config: {
          diaPago: '28', diasGracia: '7', crearFactura: '5', aplicarCorte: '1',
        },
        dia_facturacion: 1,
        dias_gracia: 5,
      }]);

      expect(await svc.resolver('c1', 'e1')).toEqual({
        diaPago: 28, diasAntesEmision: 5, diasGracia: 7,
        mesesVencidosParaCorte: 1, origen: 'cliente',
      });
    });

    it('hereda contrato y empresa cuando el cliente no tiene configuración', async () => {
      query.mockResolvedValue([{
        facturacion_config: null, dia_facturacion: 12, dias_gracia: 5,
      }]);

      expect(await svc.resolver('c1', 'e1')).toEqual({
        diaPago: 12, diasAntesEmision: null, diasGracia: 5,
        mesesVencidosParaCorte: 1, origen: 'heredada',
      });
    });

    it('"desactivado" no es una cantidad de días: no emite ni corta', async () => {
      query.mockResolvedValue([{
        facturacion_config: {
          diaPago: '15', crearFactura: 'desactivado', aplicarCorte: 'desactivado',
          diasGracia: '0',
        },
        dia_facturacion: 1, dias_gracia: 5,
      }]);

      const p = await svc.resolver('c1', 'e1');
      expect(p.diasAntesEmision).toBeNull();
      expect(p.mesesVencidosParaCorte).toBeNull();
      expect(svc.fechaCorte(p, new Date())).toBeNull();
    });

    it('recorta al día 28: es el único que existe en los doce meses', async () => {
      query.mockResolvedValue([{
        facturacion_config: { diaPago: '31' }, dia_facturacion: 1, dias_gracia: 5,
      }]);

      expect((await svc.resolver('c1', 'e1')).diaPago).toBe(28);
    });
  });

  describe('cruce de mes', () => {
    it('un abonado que vence el 1 se factura a fines del mes anterior', () => {
      const p     = politica({ diaPago: 1, diasAntesEmision: 5 });
      const venc  = svc.proximoVencimiento(p, new Date(Date.UTC(2026, 7, 15)));
      const emite = svc.fechaEmision(p, venc)!;

      expect(svc.aIso(venc)).toBe('2026-09-01');
      expect(svc.aIso(emite)).toBe('2026-08-27');
    });

    it('el vencimiento de hoy es hoy, no el del mes que viene', () => {
      const p = politica({ diaPago: 5 });
      expect(svc.aIso(svc.proximoVencimiento(p, new Date(Date.UTC(2026, 7, 5))))).toBe('2026-08-05');
    });
  });
});
