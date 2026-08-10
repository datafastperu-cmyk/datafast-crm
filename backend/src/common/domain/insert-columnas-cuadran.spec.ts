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

/**
 * **Un `INSERT ... VALUES` tiene que tener tantos valores como columnas** (2026-08-09).
 *
 * Origen: al retirar el estado `cortado` (fase 1) se añadió `origen` a un INSERT sobre
 * `servicios_historial` —el valor en la lista de `VALUES`, pero **no la columna**—. Seis columnas,
 * siete valores. PostgreSQL lo rechaza con *«INSERT has more expressions than target columns»*, y
 * el sitio donde vive es el corte por promesa de pago vencida: un camino que corre en un cron y
 * que no se ejercita al desplegar.
 *
 * Las 740 pruebas pasaban. **Ninguna podía verlo**: es una cadena de texto dentro de `ds.query()`,
 * invisible para TypeScript y para unos tests que simulan la base. Se descubrió leyendo el código
 * por otra razón, que es una forma poco fiable de encontrar defectos de dinero.
 *
 * Cuenta separadores de primer nivel: un `COALESCE(a, b)` o un `chr(1)||chr(2)` cuentan como un
 * solo valor porque sus comas van dentro de paréntesis.
 */
describe('Un INSERT declara tantos valores como columnas', () => {
  // El heredoc del shell se come las barras invertidas, asi que se nombra por su codigo.
  const BARRA = String.fromCharCode(92);
  /** Divide por comas de primer nivel, ignorando las que van dentro de paréntesis o comillas. */
  const partesDePrimerNivel = (s: string): number => {
    let nivel = 0, partes = 1, comilla = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === "'" && s[i - 1] !== BARRA) comilla = !comilla;
      if (comilla) continue;
      if (ch === '(') nivel++;
      else if (ch === ')') nivel--;
      else if (ch === ',' && nivel === 0) partes++;
    }
    return partes;
  };

  const desajustes: string[] = [];

  for (const f of ficheros) {
    const texto = fs.readFileSync(f, 'utf8');
    // INSERT INTO tabla (cols) VALUES (vals) — solo la forma con VALUES literal. Los
    // `INSERT ... SELECT` no se comprueban aquí: su recuento depende de la proyección.
    const re = /INSERT\s+INTO\s+[a-z_.]+\s*\(([^)]*)\)\s*VALUES\s*\(/gi;
    let m: RegExpExecArray | null;

    while ((m = re.exec(texto)) !== null) {
      const columnas = partesDePrimerNivel(m[1]);

      // Recorta el bloque de VALUES equilibrando paréntesis desde el de apertura.
      let i = re.lastIndex, nivel = 1, comilla = false;
      while (i < texto.length && nivel > 0) {
        const ch = texto[i];
        if (ch === "'" && texto[i - 1] !== BARRA) comilla = !comilla;
        if (!comilla) { if (ch === '(') nivel++; else if (ch === ')') nivel--; }
        i++;
      }
      const valores = partesDePrimerNivel(texto.slice(re.lastIndex, i - 1));

      if (columnas !== valores) {
        const linea = texto.slice(0, m.index).split('\n').length;
        desajustes.push(`${path.relative(SRC, f)}:${linea} — ${columnas} columnas, ${valores} valores`);
      }
    }
  }

  it('ningún INSERT tiene columnas y valores descuadrados', () => {
    expect(desajustes).toEqual([]);
  });
});
