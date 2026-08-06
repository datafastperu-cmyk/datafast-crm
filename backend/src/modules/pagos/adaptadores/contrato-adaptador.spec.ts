import { readFileSync } from 'fs';
import { join } from 'path';

import { clasificarError, esExito } from '../../../common/domain/resultado-operacion';

/**
 * El contrato del adaptador de cobro se fija en la Etapa I (F7), antes de que exista
 * ninguna integración nueva.
 *
 * El motivo es concreto: si se dejara para la Etapa II, la primera integración lo
 * definiría de facto y las demás se acomodarían a las peculiaridades de ese proveedor.
 *
 * Estos tests no ejercitan un adaptador — todavía no hay ninguno. Fijan las REGLAS del
 * contrato, que es lo que se rompería en silencio cuando alguien escriba el primero.
 */
describe('Contrato del adaptador de cobro (F7)', () => {
  const contrato = readFileSync(
    join(__dirname, 'adaptador-cobro.interface.ts'), 'utf8',
  );

  it('un adaptador NO registra pagos: solo reporta lo que dijo el proveedor', () => {
    // Si un adaptador tocara facturas, la frontera del dinero —que costó cerrar cuatro
    // copias divergentes— volvería a tener puertas, y esta vez una por proveedor.
    expect(contrato).toMatch(/NO registra pagos/);
    expect(contrato).not.toMatch(/monto_pagado/);
    expect(contrato).not.toMatch(/aplicarPago/);
  });

  it('devuelve ResultadoOperacion, nunca excepciones HTTP', () => {
    // Un 409 no le dice a un reintentador automático si volver en cinco minutos o
    // rendirse. Ese fue el error que descartó trabajo bueno en el outbox.
    expect(contrato).toMatch(/ResultadoOperacion/);
    expect(contrato).toMatch(/nunca excepciones HTTP/i);
  });

  it('exige `indeterminado` ante timeout — un timeout cobrando no significa "no pasó nada"', () => {
    // Reintentar a ciegas le cobra dos veces al abonado; reportar fallo deja dinero
    // existiendo sin registro. Las dos opciones "simples" son las dos incorrectas.
    expect(contrato).toMatch(/`indeterminado` es OBLIGATORIO ante un timeout/);
    expect(contrato).toMatch(/aceptado, sin confirmar/);
  });

  it('fija DÓNDE va el ID del proveedor, y no lo deja a criterio de cada integración', () => {
    // Todos los webhooks se reintentan: es su diseño. La idempotencia depende de que el
    // ID de la transacción caiga siempre en el mismo sitio. Si cada integración eligiera,
    // la primera que se equivoque duplica cobros.
    expect(contrato).toMatch(/referenciaExterna.*numero_operacion/s);
    expect(contrato).toMatch(/no a criterio de cada integración/);
  });

  it('obliga a verificar la firma del webhook', () => {
    // Un webhook sin verificar es un endpoint público que crea pagos.
    expect(contrato).toMatch(/verificarFirma/);
    // El comentario cruza líneas del bloque JSDoc: se busca el concepto, no el renglón.
    expect(contrato.replace(/\s*\n\s*\*\s*/g, ' ')).toMatch(/endpoint público que crea pagos/);
  });

  it('el webhook es un aviso, no una fuente de verdad: el importe se consulta', () => {
    expect(contrato).toMatch(/nunca se confía en el importe que trae el webhook/);
    expect(contrato).toMatch(/consultar\(referenciaExterna/);
  });

  it('las pasarelas son módulos degradables y la caja manual no depende de ellas', () => {
    const plano = contrato.replace(/\s*\n\s*\*\s*/g, ' ');
    expect(plano).toMatch(/Módulo degradable/);
    expect(plano).toMatch(/Core Indestructible y NUNCA puede depender/);
  });

  // ── El vocabulario que van a usar los adaptadores ya está probado ──────────
  it('un timeout se clasifica como reintentable/indeterminado, jamás como definitivo', () => {
    const r = clasificarError({ code: 'ETIMEDOUT', message: 'timeout' });
    expect(r.clase).not.toBe('rechazado_definitivo');
    expect(esExito(r)).toBe(false);
  });
});
