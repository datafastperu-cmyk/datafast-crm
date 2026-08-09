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
    tipo: 'postpago',
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
        tipo: 'postpago', diaPago: 28, diasAntesEmision: 5, diasGracia: 7,
        mesesVencidosParaCorte: 1, origen: 'cliente',
      });
    });

    it('hereda contrato y empresa cuando el cliente no tiene configuración', async () => {
      query.mockResolvedValue([{
        facturacion_config: null, dia_facturacion: 12, dias_gracia: 5,
      }]);

      expect(await svc.resolver('c1', 'e1')).toEqual({
        tipo: 'postpago', diaPago: 12, diasAntesEmision: null, diasGracia: 5,
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

  // ═══════════════════════════════════════════════════════════════════════════
  // El periodo es el CICLO DEL ABONADO, no el mes de calendario.
  //
  // Lo señaló el propietario el 2026-08-08: *«comienzo de periodo es un día después de su
  // fecha de pago y fin de periodo es la siguiente fecha de pago»*. Hasta entonces esto
  // devolvía `YYYY-MM-01` al último día del mes, así que un abonado con día de pago 10
  // recibía un comprobante que decía «01/03 – 31/03» mientras el ciclo que estaba pagando
  // iba del 11/03 al 10/04. **El dato impreso era sencillamente falso**, y contradecía al
  // resto del módulo: la emisión, el vencimiento y el corte ya salían de SU día de pago, y
  // solo el periodo seguía anclado al calendario.
  //
  // Hasta 2026-08-05 el campo `tipo` ni siquiera se leía: todo se facturaba como postpago
  // aunque el abonado estuviera marcado como prepago.
  // ═══════════════════════════════════════════════════════════════════════════
  describe('prepago vs postpago — el periodo es el ciclo del abonado', () => {
    const vencimiento = new Date(Date.UTC(2026, 7, 28)); // 28/08/2026

    it('postpago cierra el ciclo en el vencimiento: 29/07 – 28/08', () => {
      const p = svc.periodoServicio(politica({ tipo: 'postpago' }), vencimiento);
      expect(p).toMatchObject({ inicio: '2026-07-29', fin: '2026-08-28', mes: 8, anio: 2026 });
    });

    it('prepago abre el ciclo en el vencimiento: 29/08 – 28/09', () => {
      const p = svc.periodoServicio(politica({ tipo: 'prepago' }), vencimiento);
      expect(p).toMatchObject({ inicio: '2026-08-29', fin: '2026-09-28', mes: 9, anio: 2026 });
    });

    /**
     * La razón de que el inicio sea el día SIGUIENTE, y no el mismo día de pago: sin eso,
     * dos comprobantes consecutivos se solaparían justo en la fecha de pago, y el abonado
     * tendría un día facturado dos veces.
     */
    it('dos ciclos consecutivos no se solapan ni dejan hueco', () => {
      const pol   = politica({ tipo: 'postpago' });
      const marzo = svc.periodoServicio(pol, new Date(Date.UTC(2026, 2, 28)));
      const abril = svc.periodoServicio(pol, new Date(Date.UTC(2026, 3, 28)));

      expect(marzo.fin).toBe('2026-03-28');
      expect(abril.inicio).toBe('2026-03-29'); // el día siguiente exacto, sin hueco
    });

    it('febrero no se acorta: el ciclo lo marca el día de pago, no el calendario', () => {
      // Antes esto devolvía '2026-02-28' porque era el último día del mes. Ahora el 28 sale
      // del día de pago, y con día 10 el ciclo termina el 10 aunque sea febrero.
      const p = svc.periodoServicio(politica(), new Date(Date.UTC(2026, 1, 10)));
      expect(p).toMatchObject({ inicio: '2026-01-11', fin: '2026-02-10' });

      // Y el bisiesto deja de importar. `diaPago` está acotado a 28 (`DIA_PAGO_MAXIMO`),
      // así que el día 28 existe en los doce meses de cualquier año y el ciclo nunca tiene
      // que decidir qué hacer con un 30 o un 31 que no existe.
      expect(svc.periodoServicio(politica(), new Date(Date.UTC(2028, 1, 28))))
        .toMatchObject({ inicio: '2028-01-29', fin: '2028-02-28' });
    });

    it('prepago en diciembre cruza de año', () => {
      const p = svc.periodoServicio(politica({ tipo: 'prepago' }), new Date(Date.UTC(2026, 11, 28)));
      expect(p).toMatchObject({ inicio: '2026-12-29', fin: '2027-01-28', mes: 1, anio: 2027 });
    });
  });

  describe('preferencias de notificación', () => {
    it('el interruptor general apaga los tres recordatorios', () => {
      const prefs = svc.notificacionesDesde({
        recordatoriosPago: 'desactivado',
        recordatorio1: '-3', recordatorio2: '-1', recordatorio3: '2',
      });
      expect(prefs.recordatorios).toHaveLength(0);
    });

    it('conserva el signo del offset: negativo antes, positivo después', () => {
      const prefs = svc.notificacionesDesde({
        recordatoriosPago: 'whatsapp',
        recordatorio1: '-3', recordatorio2: 'desactivado', recordatorio3: '2',
      });
      expect(prefs.recordatorios).toEqual([
        { dias: -3, plantilla: null, indice: 1 },
        { dias:  2, plantilla: null, indice: 3 },
      ]);
    });

    it('sin configuración no se envía nada: el silencio es el valor seguro', () => {
      const prefs = svc.notificacionesDesde(null);
      expect(prefs.avisoNuevaFactura).toBeNull();
      expect(prefs.recordatoriosPago).toBeNull();
      expect(prefs.recordatorios).toHaveLength(0);
    });

    it('la plantilla del aviso de factura se lee de facturacion_config', () => {
      const prefs = svc.notificacionesDesde(
        { avisoNuevaFactura: 'whatsapp' },
        { plantillaAvisoFactura: 'nueva_factura' },
      );
      expect(prefs.avisoNuevaFactura).toBe('whatsapp');
      expect(prefs.plantillaAvisoFactura).toBe('nueva_factura');
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
