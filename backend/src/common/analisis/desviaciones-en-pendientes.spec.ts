import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// Toda desviación abierta en POL-001 aparece en PENDIENTES.md.
//
// Origen (2026-08-08, petición del propietario): *«los temas abiertos o pendientes ándalos
// anotando, y así no tenemos que hacer una auditoría completa para hallarlos»*.
//
// **PD-10 ya lo exigía** —«todo trabajo que quede abierto se registra en PENDIENTES.md»— y,
// como PA-12 y como el latido, era una política sin mecanismo. Este test es el mecanismo.
//
// No compara contenidos: POL-001 Anexo B es la fuente del detalle y duplicarlo crearía dos
// verdades (R-006). Solo comprueba que **el identificador está listado**, que es lo que
// permite responder «¿qué queda abierto?» sin releer el corpus entero.
// ═══════════════════════════════════════════════════════════════════════════
describe('Toda desviación abierta está en PENDIENTES.md (PD-10)', () => {
  const RAIZ = join(__dirname, '..', '..', '..', '..');
  const pol = readFileSync(join(RAIZ, 'docs', 'gobierno', 'POL-001-politicas-corporativas.md'), 'utf8');
  const pendientes = readFileSync(join(RAIZ, 'PENDIENTES.md'), 'utf8');

  /**
   * Solo las tablas de desviaciones, no el «Registro de cierres» — allí las ya cerradas
   * aparecen SIN tachar (es su lista de logros), y contarlas como abiertas daba ocho falsos
   * positivos, entre ellos A-1 y A-4, que se cerraron hoy mismo.
   *
   * Se distingue por la forma de la fila: en las desviaciones el identificador va seguido de
   * `| **POLÍTICA**`; en los cierres, de ` — descripción`.
   */
  const anexoB = pol.slice(0, pol.indexOf('**Registro de cierres:**'));

  /** Una fila cuyo identificador va tachado (`~~**B-9**~~`) está cerrada o retirada. */
  const abiertas = (): string[] => {
    const out: string[] = [];
    for (const m of anexoB.matchAll(/^\| (~~)?\*\*([ABC]-\d+)\*\*(~~)? \| /gm)) {
      if (!m[1]) out.push(m[2]);
    }
    return [...new Set(out)];
  };

  it('ninguna desviación abierta falta en el índice de PENDIENTES.md', () => {
    const faltan = abiertas().filter((id) => !pendientes.includes(`**${id}**`));

    // Si esto falla: se abrió una desviación en POL-001 y no se anotó. Añádela al índice
    // (`📋 Índice de desviaciones abiertas`); si además tiene consecuencia operativa, dale
    // su propia entrada con qué falta, por qué importa y cómo se comprueba.
    expect(faltan).toEqual([]);
  });

  // El error inverso: una desviación se cierra en POL-001 y su entrada sigue en PENDIENTES
  // diciendo que está abierta. Un pendiente resuelto que nadie retira hace que la lista
  // deje de ser creíble, y entonces se ignora entera.
  it('ninguna desviación cerrada sigue anunciada como abierta', () => {
    const cerradas: string[] = [];
    for (const m of pol.matchAll(/^\| ~~\*\*([ABC]-\d+)\*\*~~/gm)) cerradas.push(m[1]);

    const indice = pendientes.slice(pendientes.indexOf('📋 Índice de desviaciones abiertas'));
    const fantasmas = [...new Set(cerradas)].filter((id) => indice.includes(`**${id}**`));

    expect(fantasmas).toEqual([]);
  });

  it('PENDIENTES.md sigue siendo el registro vivo que PD-10 exige', () => {
    expect(pendientes).toContain('Índice de desviaciones abiertas');
    // Sin fecha, nadie sabe si lo que lee es de hoy o de hace seis meses.
    expect(pendientes).toMatch(/Última actualización: \d{4}-\d{2}-\d{2}/);
  });
});
