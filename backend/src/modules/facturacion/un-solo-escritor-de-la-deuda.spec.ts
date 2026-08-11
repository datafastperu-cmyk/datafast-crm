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
 */
describe('A-4 · Un solo escritor de la proyección de deuda', () => {
  const DUENO = path.join('modules', 'facturacion', 'deuda-por-contrato.service.ts');

  it('solo DeudaPorContratoService escribe deuda_total', () => {
    const infractores = ficheros
      .filter((f) => path.relative(SRC, f) !== DUENO)
      .filter((f) => /\bdeuda_total\s*=/.test(sinComentarios(fs.readFileSync(f, 'utf8'))))
      .map((f) => path.relative(SRC, f));

    expect(infractores).toEqual([]);
  });

  it('solo DeudaPorContratoService escribe meses_deuda', () => {
    // Viaja con la deuda: se calculan juntos y ponerlos a cero por separado deja la ficha
    // diciendo "0 meses" con saldo pendiente.
    const infractores = ficheros
      .filter((f) => path.relative(SRC, f) !== DUENO)
      .filter((f) => /\bmeses_deuda\s*=/.test(sinComentarios(fs.readFileSync(f, 'utf8'))))
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
