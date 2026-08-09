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

    /**
     * Antes esto recortaba a 28 «porque es el único día que existe en los doce meses».
     * Cambió el 2026-08-09: el anclaje se guarda **tal cual** y el recorte ocurre al
     * materializar cada fecha. Guardarlo ya recortado haría derivar el ciclo — ver el
     * bloque «anclaje de ciclo» más abajo.
     */
    it('el anclaje se guarda íntegro: no se recorta al resolver la política', async () => {
      query.mockResolvedValue([{
        facturacion_config: { diaPago: '31' }, dia_facturacion: 1, dias_gracia: 5,
      }]);

      expect((await svc.resolver('c1', 'e1')).diaPago).toBe(31);
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
  // ═══════════════════════════════════════════════════════════════════════════
  // Anclaje de ciclo con recorte a fin de mes (2026-08-09, POL-001 PD-13).
  //
  // Antes el día de pago estaba topado en 28 —«el único que existe en los doce meses»—, que
  // evita el problema de febrero PROHIBIENDO los tres días de cierre más usados en tarifa
  // plana. El sector lo resuelve al revés: Stripe documenta `day_of_month = 31` con recorte
  // al último día real del mes.
  //
  // Lo que estos tests protegen es la parte que se hace mal: **el anclaje no se toca, solo
  // se recorta la materialización.** Si tras cobrar el 28 de febrero se guardara «28» como
  // nuevo día de pago, el abonado se quedaría en 28 para siempre y el ciclo habría derivado
  // sin que nadie lo decidiera.
  // ═══════════════════════════════════════════════════════════════════════════
  describe('anclaje de ciclo — recorte a fin de mes sin deriva', () => {
    const ancla31 = politica({ diaPago: 31 });
    const vencEn = (pol: PoliticaFacturacion, anio: number, mes: number) =>
      svc.aIso(svc.proximoVencimiento(pol, new Date(Date.UTC(anio, mes - 1, 1))));

    it('el anclaje se recorta al último día real de cada mes', () => {
      expect(vencEn(ancla31, 2026, 1)).toBe('2026-01-31');
      expect(vencEn(ancla31, 2026, 2)).toBe('2026-02-28'); // febrero común
      expect(vencEn(ancla31, 2028, 2)).toBe('2028-02-29'); // bisiesto
      expect(vencEn(ancla31, 2026, 4)).toBe('2026-04-30'); // mes de 30
      expect(vencEn(politica({ diaPago: 30 }), 2026, 2)).toBe('2026-02-28');
    });

    /**
     * **El test que importa.** Recortar es fácil; no derivar, no. Marzo vuelve al 31 porque
     * cada fecha se materializa desde el anclaje, nunca desplazando la anterior.
     */
    it('tras febrero el anclaje VUELVE al 31: no se queda en 28', () => {
      expect(vencEn(ancla31, 2026, 3)).toBe('2026-03-31');
      expect(vencEn(ancla31, 2026, 5)).toBe('2026-05-31');
    });

    it('el ciclo no se solapa ni deja hueco al cruzar febrero', () => {
      const pol = politica({ diaPago: 31, tipo: 'postpago' });
      // El ciclo que cierra el 28/02 abrió el día siguiente al 31/01.
      expect(svc.periodoServicio(pol, new Date(Date.UTC(2026, 1, 28))))
        .toMatchObject({ inicio: '2026-02-01', fin: '2026-02-28' });
      // Y el siguiente arranca el 1/03 —sin hueco ni solape— y cierra en el anclaje.
      expect(svc.periodoServicio(pol, new Date(Date.UTC(2026, 2, 31))))
        .toMatchObject({ inicio: '2026-03-01', fin: '2026-03-31' });
    });

    /**
     * `Date.UTC(2026, 1, 31)` es el **3 de marzo**. El código anterior usaba esa aritmética
     * y funcionaba **por accidente**: con el tope en 28 nunca recibía un 29, 30 ni 31.
     */
    it('ninguna fecha del ciclo se desborda al mes siguiente', () => {
      for (const dia of [29, 30, 31]) {
        const pol = politica({ diaPago: dia });
        const v   = svc.proximoVencimiento(pol, new Date(Date.UTC(2026, 1, 1)));

        // El vencimiento de febrero cae en febrero, recortado. El síntoma del
        // desbordamiento sería marzo.
        expect(svc.aIso(v)).toBe('2026-02-28');

        const p = svc.periodoServicio(pol, v);
        expect(p.fin).toBe('2026-02-28');
        // El inicio sale del anclaje del mes anterior + 1 día: 30/01, 31/01 y 01/02
        // respectivamente. Ninguno en marzo, que es lo que este test vigila.
        expect(p.inicio.startsWith('2026-03')).toBe(false);
        expect(p.inicio < p.fin).toBe(true);
      }
    });

    /**
     * `periodoServicio` normaliza el vencimiento al anclaje de su mes. Sin eso tendría una
     * precondición tácita —«el día que recibes ES el anclaje»— y devolvería un periodo con
     * un extremo derivado del anclaje y el otro del día suelto que le pasaran.
     */
    it('el periodo sale del ANCLAJE aunque se le pase otra fecha del mismo mes', () => {
      const pol = politica({ diaPago: 28, tipo: 'postpago' });
      const desdeElAncla = svc.periodoServicio(pol, new Date(Date.UTC(2026, 1, 28)));
      const desdeOtroDia = svc.periodoServicio(pol, new Date(Date.UTC(2026, 1, 10)));

      expect(desdeOtroDia).toEqual(desdeElAncla);
      expect(desdeElAncla).toMatchObject({ inicio: '2026-01-29', fin: '2026-02-28' });
    });

    it('el anclaje admite hasta 31 y acota lo que se salga de rango', async () => {
      query.mockResolvedValueOnce([{
        facturacion_config: { diaPago: '31' }, dia_facturacion: null, dias_gracia: 5,
      }]);
      expect((await svc.resolver('c1', 'e1')).diaPago).toBe(31);

      query.mockResolvedValueOnce([{
        facturacion_config: { diaPago: '45' }, dia_facturacion: null, dias_gracia: 5,
      }]);
      expect((await svc.resolver('c1', 'e1')).diaPago).toBe(31);
    });
  });

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

    it('febrero no acorta el ciclo de quien no está anclado a fin de mes', () => {
      // Con anclaje 10, febrero cierra el 10 como cualquier otro mes: el ciclo lo marca el
      // día de pago, no el calendario. Antes de que el periodo fuera el ciclo del abonado,
      // esto devolvía '2026-02-01 → 2026-02-28'.
      const dia10 = politica({ diaPago: 10 });
      expect(svc.periodoServicio(dia10, new Date(Date.UTC(2026, 1, 10))))
        .toMatchObject({ inicio: '2026-01-11', fin: '2026-02-10' });

      // Y a quien SÍ está anclado a fin de mes, febrero se lo recorta — pero solo ese mes.
      const dia31 = politica({ diaPago: 31 });
      expect(svc.periodoServicio(dia31, new Date(Date.UTC(2028, 1, 29))))
        .toMatchObject({ inicio: '2028-02-01', fin: '2028-02-29' }); // bisiesto
      expect(svc.periodoServicio(dia31, new Date(Date.UTC(2028, 2, 31))))
        .toMatchObject({ inicio: '2028-03-01', fin: '2028-03-31' }); // y vuelve al 31
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
