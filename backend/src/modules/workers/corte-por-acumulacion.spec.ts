import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SQL_COMPROBANTE_VENCIDO } from '../facturacion/domain/mora';

// ═══════════════════════════════════════════════════════════════════════════
// La regla del corte, dicha por el propietario el 2026-08-08:
//
//   «El sistema te tolera N comprobantes vencidos antes de cortarte, y además te ofrece
//    N días de gracia LUEGO DEL ÚLTIMO COMPROBANTE VENCIDO. Un comprobante cuenta como
//    vencido desde el día siguiente de su día de pago.»
//
// El código medía la gracia desde `MIN(fecha_vencimiento)` —el comprobante más ANTIGUO—
// y eso tenía dos efectos:
//
//   1. Cortaba antes de tiempo. Con día de pago 10, el tercer vencimiento cae el 10/03 y
//      se cortaba el 11/03 en lugar del 15/03.
//   2. Y lo que pesa más: **hacía inertes los días de gracia siempre que
//      `aplicarCorte >= 2`**. Para cuando se acumula el segundo comprobante, el más
//      antiguo lleva un mes vencido y cualquier gracia razonable ya está superada.
//
// Nadie lo notó porque con `aplicarCorte = 1` —el valor heredado por defecto— MIN y MAX
// son el mismo comprobante y el resultado coincide. El defecto solo aparece en la
// configuración que el propietario usa de verdad.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * La decisión, reproducida tal cual la toma `detectarMorosos` sobre las filas que le
 * devuelve la consulta. Se prueba aquí porque el bucle vive dentro de un `@Process` que
 * necesita Redis, y lo que hay que fijar es el criterio, no el andamiaje de la cola.
 */
const debeCortar = (
  comprobantesVencidos: number,
  diasDesdeUltimoVencimiento: number,
  aplicarCorte: number | null,
  diasGracia: number | null,
): boolean => {
  if (!diasGracia) return false;      // 0 = "sin corte automático" (así lo dice la UI)
  if (!aplicarCorte) return false;    // "desactivado" = a este abonado no se le corta
  if (comprobantesVencidos < aplicarCorte) return false;
  return diasDesdeUltimoVencimiento >= diasGracia;
};

describe('Corte por acumulación — «N vencidos MÁS N días desde el último»', () => {
  // El caso del propietario: aplicar corte = 3, gracia = 5, día de pago 10.
  // 1.ª vence 10/01 · 2.ª 10/02 · 3.ª 10/03 → se corta el 15/03, no el 11/03.
  it('con 3 vencidos y 5 días de gracia, no corta hasta 5 días DESPUÉS del tercero', () => {
    expect(debeCortar(3, 0, 3, 5)).toBe(false); // 10/03, el mismo día del tercero
    expect(debeCortar(3, 1, 3, 5)).toBe(false); // 11/03 — aquí cortaba antes, midiendo desde el primero
    expect(debeCortar(3, 4, 3, 5)).toBe(false); // 14/03
    expect(debeCortar(3, 5, 3, 5)).toBe(true);  // 15/03 ✓
  });

  it('la tolerancia manda sobre la gracia: con 2 vencidos no corta aunque sobren días', () => {
    // 10/02: hay dos vencidos y el más antiguo lleva 31 días. Antes esto ya cumplía la
    // condición de gracia; ahora ni siquiera se evalúa, porque faltan comprobantes.
    expect(debeCortar(2, 31, 3, 5)).toBe(false);
  });

  it('con `aplicarCorte = 1` el resultado no cambia: es donde MIN y MAX coinciden', () => {
    expect(debeCortar(1, 4, 1, 5)).toBe(false);
    expect(debeCortar(1, 5, 1, 5)).toBe(true);
  });

  it('gracia 0 es "sin corte automático", no "cortar el mismo día"', () => {
    expect(debeCortar(9, 999, 3, 0)).toBe(false);
    expect(debeCortar(9, 999, 3, null)).toBe(false);
  });

  it('`aplicarCorte` desactivado no corta nunca, por mucha deuda que haya', () => {
    expect(debeCortar(12, 400, null, 5)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// La barrera. El criterio de arriba es correcto solo si la consulta le entrega los días
// contados desde el ÚLTIMO vencimiento. Si alguien vuelve a poner `MIN`, los tests de
// decisión seguirían pasando y el corte volvería a adelantarse — que es exactamente cómo
// pasó inadvertido la primera vez.
// ═══════════════════════════════════════════════════════════════════════════
describe('La consulta mide la gracia desde el último vencimiento (barrera)', () => {
  const worker = readFileSync(join(__dirname, 'cobranza.worker.ts'), 'utf8');

  /** El bloque de la CTE `impagas`, que es la que alimenta el corte. */
  const cte = (): string => {
    const desde = worker.indexOf('WITH impagas AS (');
    expect(desde).toBeGreaterThan(-1);
    return worker.slice(desde, worker.indexOf('GROUP BY cliente_id', desde));
  };

  it('agrega con MAX(fecha_vencimiento), nunca con MIN', () => {
    expect(cte()).toContain('MAX(fecha_vencimiento)');
    // Si esto falla: alguien volvió a medir desde el comprobante más antiguo. La regla es
    // «N días luego del ÚLTIMO comprobante vencido» (propietario, 2026-08-08).
    expect(cte()).not.toContain('MIN(fecha_vencimiento)');
  });

  it('qué cuenta como comprobante vencido lo define `mora.ts`, no esta consulta', () => {
    // El corte y la etiqueta de mora hacen dos preguntas distintas —«¿cuántos y desde
    // cuándo?» frente a «¿hay alguno?»— sobre UN SOLO criterio. Si el corte reescribiera
    // las condiciones a mano, podrían divergir: un abonado etiquetado en mora al que el
    // corte no ve, o al revés. Es el defecto de A-4 en pequeño.
    expect(cte()).toContain('SQL_COMPROBANTE_VENCIDO()');

    // Y ese criterio incluye lo que aquí importa: exigible (ni pagada, ni anulada, ni nota
    // de crédito — A-5), con saldo, y vencido desde el día siguiente al día de pago. Lo
    // fija `mora-es-etiqueta.spec.ts`.
    expect(SQL_COMPROBANTE_VENCIDO()).toContain('fecha_vencimiento < CURRENT_DATE');
    expect(SQL_COMPROBANTE_VENCIDO()).toContain('factura_original_id IS NULL');
    expect(SQL_COMPROBANTE_VENCIDO()).toContain('COALESCE(saldo, total - monto_pagado) > 0');
  });
});
