import * as fs from 'fs';
import * as path from 'path';

const SRC = path.join(__dirname, '..', '..');

const ficheros: string[] = [];
(function recorrer(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'migrations') recorrer(p); }
    else if (e.name.endsWith('.ts') && !e.name.includes('.spec.')) ficheros.push(p);
  }
})(SRC);

const sinComentarios = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/^\s*--.*$/gm, '');

/**
 * A-4 — **la deuda tiene una definición y un escritor** (cola cerrada el 2026-08-10).
 *
 * `servicios.deuda_total` no es un dato: es una PROYECCIÓN de las facturas. La fuente de verdad es
 * `facturas.saldo`, que además es una columna generada. Cuando alguien escribe la proyección a
 * mano, deja de coincidir con lo que la respalda y el ERP responde distinto según por dónde se le
 * pregunte — el incidente del 2026-08-04, con la ficha mostrando S/ 64 y una deuda real de S/ 128.
 *
 * A-4 dejó `DeudaPorContratoService.recalcularPorCliente` como único escritor. **Quedaban dos
 * fugas**, y la segunda solo se vio al medir la cola:
 *
 *   · `contratos.service` escribía `deuda_total = 0` al reactivar — retirado en su momento.
 *   · `cobranza.worker` hacía lo mismo en la reactivación automática, y **desde H-7 además era
 *     falso**: reactivar exige deuda VENCIDA cero, no deuda total cero. Un abonado con un
 *     comprobante emitido y aún sin vencer se reactiva con razón, y ponerle la proyección a cero
 *     borraba esa deuda de su ficha. El mismo defecto del 04/08, del revés.
 *
 * Poner la proyección a cero es tentador porque suele ser cierto. La barrera existe porque «suele»
 * no es «siempre», y porque el que la escribe nunca es el que descubre que fallaba.
 *
 * **Ola 4 (2026-08-18): el acumulador se retira, y la barrera gana una segunda clase de
 * excepción.** `deuda_total`/`meses_deuda` dejan de ser columnas escritas por nadie —
 * `DeudaPorContratoService.calcular()` sigue siendo la única FUENTE del número, pero algunos
 * ficheros ahora ETIQUETAN ese número ya calculado sobre una fila de resultado, con el mismo
 * nombre de campo que tenía cuando la columna existía (D-1 §5: «no existe deuda del cliente
 * como dato, es suma derivada, SOLO PARA PRESENTACIÓN» — E02-12 prohíbe el agregado
 * ALMACENADO, no expuesto). Es una asignación de JS sobre un objeto en memoria, nunca un
 * `UPDATE`/`.update()` contra la tabla — el regex de abajo no distingue eso por sí solo, así
 * que la distinción la hace esta lista, explícita y con su propia comprobación (abajo) de que
 * ninguno de sus ficheros esconde una escritura real.
 */
describe('A-4 · Un solo escritor de la proyección de deuda', () => {
  const DUENO = path.join('modules', 'facturacion', 'deuda-por-contrato.service.ts');

  // Cada entrada exige, en su propio commit: por qué expone el campo (qué respuesta HTTP lo
  // necesita) y confirmación de que no hay un `UPDATE`/`.update(` tocando la columna real.
  const ETIQUETAN_VALOR_YA_CALCULADO = [
    // findCompleto()/findByClienteCompleto(): la ficha de contrato y el listado por cliente
    // devuelven `deudaTotal`/`deuda_total` al frontend desde siempre; el valor ahora sale de
    // `this.deudaSvc.calcular(...)` y se escribe en la fila de RESPUESTA, no en `servicios`.
    path.join('modules', 'contratos', 'repositories', 'contrato.repository.ts'),
  ];

  it('solo DeudaPorContratoService escribe deuda_total', () => {
    const infractores = ficheros
      .filter((f) => path.relative(SRC, f) !== DUENO)
      .filter((f) => !ETIQUETAN_VALOR_YA_CALCULADO.includes(path.relative(SRC, f)))
      .filter((f) => /\bdeuda_total\s*=/.test(sinComentarios(fs.readFileSync(f, 'utf8'))))
      .map((f) => path.relative(SRC, f));

    expect(infractores).toEqual([]);
  });

  it('solo DeudaPorContratoService escribe meses_deuda', () => {
    // Viaja con la deuda: se calculan juntos y ponerlos a cero por separado deja la ficha
    // diciendo "0 meses" con saldo pendiente.
    const infractores = ficheros
      .filter((f) => path.relative(SRC, f) !== DUENO)
      .filter((f) => !ETIQUETAN_VALOR_YA_CALCULADO.includes(path.relative(SRC, f)))
      .filter((f) => /\bmeses_deuda\s*=/.test(sinComentarios(fs.readFileSync(f, 'utf8'))))
      .map((f) => path.relative(SRC, f));

    expect(infractores).toEqual([]);
  });

  it('las excepciones NUNCA esconden una escritura real contra la tabla', () => {
    // La lista de arriba solo puede eximir asignaciones en memoria. Si alguno de esos
    // ficheros contiene un UPDATE SQL o un `.update(` de TypeORM tocando estas columnas,
    // la excepción se convirtió exactamente en la fuga que A-4 cerró — falla aquí, no en
    // producción.
    const escrituraReal = /UPDATE\s+\w+[\s\S]{0,200}?\b(deuda_total|meses_deuda)\b|\.update\([\s\S]{0,200}?\b(deudaTotal|mesesDeuda|deuda_total|meses_deuda)\b/;

    const infractores = ETIQUETAN_VALOR_YA_CALCULADO
      .map((rel) => path.join(SRC, rel))
      .filter((f) => escrituraReal.test(sinComentarios(fs.readFileSync(f, 'utf8'))))
      .map((f) => path.relative(SRC, f));

    expect(infractores).toEqual([]);
  });

  it('la reactivación automática refresca la proyección en vez de asumirla', () => {
    // Si alguien vuelve a poner `deuda_total = 0` aquí, el test de arriba lo dice. Este comprueba
    // lo contrario: que SÍ se recalcula, porque quitar la escritura sin poner el recálculo dejaría
    // la ficha congelada en la deuda anterior, que es igual de falso.
    const worker = sinComentarios(
      fs.readFileSync(path.join(SRC, 'modules', 'workers', 'cobranza.worker.ts'), 'utf8'),
    );
    expect(worker).toContain('recalcularPorCliente(');
  });
});
