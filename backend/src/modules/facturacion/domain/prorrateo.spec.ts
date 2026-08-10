import {
  BASE_PRORRATEO,
  DENOMINADOR_PRORRATEO,
  cargoDelPeriodo,
  diasFacturables,
} from './prorrateo';
import { anclaEnMes, diasDelMes } from '../politica-facturacion.service';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * PD-14 — el prorrateo tiene UNA definición (2026-08-09).
 *
 * Antes de esta política convivían dos fórmulas en documentos ya commiteados: `mínimo(precio,
 * precio/30 × días)` en §7-ter y `precio × días / díasDelCiclo` en el diseño de H-6. Con 8 días de
 * un ciclo de 31 daban S/17,07 y S/16,52 — dos definiciones del mismo importe divergiendo, que es
 * exactamente lo que el corpus prohíbe.
 */
describe('PD-14 · Prorrateo ACTUAL_360', () => {
  describe('conteo inclusivo — un día con servicio es un día facturable', () => {
    it('del 10/08 al 30/08 son 21 días, no 20', () => {
      // El 20 sale de contar [10/08, 30/08), media abierta. Se descartó: el abonado tuvo servicio
      // el día de instalación y el del corte.
      expect(diasFacturables(d('2026-08-10'), d('2026-08-30'))).toBe(21);
    });

    it('un solo día cuenta como uno', () => {
      expect(diasFacturables(d('2026-08-10'), d('2026-08-10'))).toBe(1);
    });

    it('cruza el cambio de mes y de año sin perder el día del salto', () => {
      expect(diasFacturables(d('2026-12-31'), d('2027-01-30'))).toBe(31);
    });
  });

  describe('la fórmula', () => {
    it('el ejemplo de la política: S/80, 21 días de un ciclo de 31 → S/56,00', () => {
      const c = cargoDelPeriodo(80, 31, 21);
      expect(c.tipo).toBe('prorrateado');
      expect(c.importe).toBe(56);
    });

    it('redondea a dos decimales', () => {
      // 85 × 7 / 30 = 19,8333…
      expect(cargoDelPeriodo(85, 31, 7).importe).toBe(19.83);
    });

    it('el importe NO se obtiene multiplicando la tarifa diaria — se redondea una sola vez', () => {
      const c = cargoDelPeriodo(64.9, 30, 7);
      // Recalcular desde los seis decimales de la tarifa diaria puede desplazar el céntimo.
      // `importe` es el único valor que se cobra; `tarifaDiaria` solo explica el recibo.
      expect(c.importe).toBe(Math.round((64.9 * 7 * 100) / 30) / 100);
      expect(c.tarifaDiaria).toBeCloseTo(2.163333, 6);
    });

    it('cero días entregados no cobra nada', () => {
      expect(cargoDelPeriodo(80, 31, 0).importe).toBe(0);
    });
  });

  describe('el ciclo completo nunca se prorratea', () => {
    it.each([28, 29, 30, 31])('un ciclo de %i días cobra el precio íntegro', (dias) => {
      const c = cargoDelPeriodo(80, dias, dias);
      expect(c.tipo).toBe('completo');
      expect(c.importe).toBe(80);
    });

    it('febrero entero cuesta lo mismo que marzo entero', () => {
      expect(cargoDelPeriodo(80, 28, 28).importe).toBe(cargoDelPeriodo(80, 31, 31).importe);
    });
  });

  /**
   * La garantía que PD-14 afirma, comprobada en vez de declarada.
   *
   * La fórmula anterior llevaba un `mínimo(precio, ...)` porque `31 × precio/30` da el 103 % de la
   * mensualidad. Al separar ciclo y prorrateo el tope quedó **inalcanzable**: un tramo prorrateado
   * es por definición parcial, así que como mucho son 30 días de un ciclo de 31 —el más largo que
   * el anclaje puede producir— y eso da exactamente el precio.
   *
   * Se recorre con los ciclos REALES que genera `anclaEnMes`, no con longitudes inventadas: si
   * alguien cambiara el recorte a fin de mes y apareciera un ciclo de 32 días, este test lo dice.
   */
  describe('el tope es inalcanzable — todo anclaje, todo mes', () => {
    const PRECIO = 80;

    /** Ciclos reales de un año para un anclaje dado, tal como los produce el modelo. */
    const ciclosDelAnio = (anio: number, anclaje: number): number[] =>
      Array.from({ length: 12 }, (_, i) => {
        const cierre   = anclaEnMes(anio, i + 1, anclaje);
        const anterior = i === 0
          ? anclaEnMes(anio - 1, 12, anclaje)
          : anclaEnMes(anio, i, anclaje);
        const inicio = new Date(anterior.getTime());
        inicio.setUTCDate(inicio.getUTCDate() + 1); // el ancla cierra; el siguiente abre al día después
        return diasFacturables(inicio, cierre);
      });

    it.each([2026, 2028])('en %i ningún tramo parcial supera la mensualidad', (anio) => {
      for (let anclaje = 1; anclaje <= 31; anclaje++) {
        for (const dias of ciclosDelAnio(anio, anclaje)) {
          for (let entregados = 0; entregados < dias; entregados++) {
            const { importe } = cargoDelPeriodo(PRECIO, dias, entregados);
            expect(importe).toBeLessThanOrEqual(PRECIO);
          }
        }
      }
    });

    it('ningún ciclo del modelo pasa de 31 días — de ahí sale la garantía', () => {
      for (const anio of [2026, 2028]) {
        for (let anclaje = 1; anclaje <= 31; anclaje++) {
          for (const dias of ciclosDelAnio(anio, anclaje)) {
            expect(dias).toBeLessThanOrEqual(31);
            expect(dias).toBeGreaterThanOrEqual(28);
          }
        }
      }
    });

    it('el máximo posible —30 de 31 días— da exactamente la mensualidad', () => {
      expect(cargoDelPeriodo(PRECIO, 31, 30).importe).toBe(PRECIO);
    });

    it('2028 es bisiesto: el modelo lo refleja', () => {
      expect(diasDelMes(2028, 2)).toBe(29);
    });
  });

  describe('la base viaja con el cargo', () => {
    it('un cargo prorrateado lleva base, denominador, días y tarifa diaria', () => {
      // Sin esto, cambiar la política algún día reescribiría la aritmética de facturas ya emitidas.
      expect(cargoDelPeriodo(80, 31, 21)).toEqual({
        tipo:         'prorrateado',
        importe:      56,
        dias:         21,
        base:         'ACTUAL_360',
        denominador:  30,
        tarifaDiaria: 2.666667,
      });
    });

    it('la etiqueta es ACTUAL_360, nunca 30/360', () => {
      // 30/360 cuenta también el numerador en meses de 30 días: es otra convención y otros
      // importes. El nombre evita que alguien implemente la otra creyendo que es la misma.
      expect(BASE_PRORRATEO).toBe('ACTUAL_360');
      expect(DENOMINADOR_PRORRATEO).toBe(30);
    });
  });

  describe('entradas imposibles fallan ruidosamente', () => {
    it('más días entregados que días del ciclo', () => {
      expect(() => cargoDelPeriodo(80, 30, 31)).toThrow(/fuera del ciclo/);
    });

    it('un ciclo de cero días', () => {
      expect(() => cargoDelPeriodo(80, 0, 0)).toThrow(/positivo/);
    });
  });
});
