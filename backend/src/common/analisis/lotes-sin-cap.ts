import * as fs from 'fs';
import * as path from 'path';

/**
 * PA-15 — **lotes de fondo sin tope**.
 *
 * Un lote sin límite no se degrada al crecer: se cae de golpe el día que el volumen pasa un
 * umbral que nadie conoce. Y contra hardware es peor que caerse — el MA5800 tiene un límite bajo
 * de sesiones VTY concurrentes, y un barrido sin cap ya provocó 1788 reintentos en cuatro días.
 *
 * **Qué NO cuenta como lote.** El primer recuento decía 89 sobre 114 y estaba inflado: contaba
 * agregados, comprobaciones de existencia y búsquedas por clave, donde un `LIMIT` no significa
 * nada. Un informe que exagera se deja de leer, así que aquí se descuentan:
 *
 *   · agregados sin `GROUP BY` — devuelven una fila por definición;
 *   · `SELECT 1` y `EXISTS` — preguntan sí o no;
 *   · búsquedas por identificador (`WHERE ... id = $n`) — devuelven una fila;
 *   · las que ya tienen `LIMIT`.
 *
 * Lo que queda es lo que de verdad recorre un conjunto que crece con el parque.
 */

export interface LoteSinCap {
  fichero: string;
  tabla: string;
  fragmento: string;
}

const ES_DE_FONDO = /(worker|watcher|scheduler|cron|reconciliador|barrido)/i;

const AGREGADO_SOLO = /SELECT\s+(COALESCE\s*\(\s*)?(COUNT|SUM|MAX|MIN|AVG)\s*\(/i;
const EXISTENCIA = /SELECT\s+1\b/i;
const POR_CLAVE = /\bWHERE\b[^;]*?\b[a-z_]*id\s*=\s*\$\d/i;

export function analizar(raiz = 'src'): { total: number; lotes: LoteSinCap[] } {
  const ficheros: string[] = [];
  (function recorrer(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'migrations') recorrer(p); }
      else if (e.name.endsWith('.ts') && !e.name.includes('.spec.')) ficheros.push(p);
    }
  })(raiz);

  let total = 0;
  const lotes: LoteSinCap[] = [];

  for (const f of ficheros) {
    const s = fs.readFileSync(f, 'utf8');
    const deFondo = ES_DE_FONDO.test(f) || /@Cron\(|new CronJob\(/.test(s);
    if (!deFondo) continue;

    for (const q of s.match(/`[^`]*\bSELECT\b[^`]*`/gis) ?? []) {
      if (!/\bFROM\b/i.test(q)) continue;

      // Se colapsan las subconsultas antes de juzgar nada. Un SELECT dentro de un `NOT IN` es
      // una prueba de pertenencia, no un lote: ponerle `LIMIT` cambiaría el resultado en vez de
      // acotarlo. Y sin colapsarlas, el `FROM` que se reportaba era el de la subconsulta — dos
      // de los primeros hallazgos decían `FROM ftth_onu_registro` cuando la consulta externa
      // recorría un pool.
      let externa = q;
      let antes: string;
      do { antes = externa; externa = externa.replace(/\([^()]*\)/g, '()'); } while (externa !== antes);
      if (!/\bFROM\b/i.test(externa)) continue;

      const agregadoPuro = AGREGADO_SOLO.test(externa) && !/\bGROUP\s+BY\b/i.test(externa);
      if (agregadoPuro || EXISTENCIA.test(externa)) continue;

      total++;

      if (/\bLIMIT\b/i.test(externa)) continue;
      if (POR_CLAVE.test(externa)) continue;
      // `unnest` expande un array que ya viene acotado por quien lo construye: no es una tabla
      // que crezca con el parque.
      if (/\bFROM\s+unnest\b/i.test(externa)) continue;

      lotes.push({
        fichero: path.relative(raiz, f).split(path.sep).join('/'),
        tabla: (/\bFROM\s+([a-z_]+)/i.exec(externa) || [, '?'])[1],
        fragmento: q.replace(/\s+/g, ' ').slice(1, 90),
      });
    }
  }

  return { total, lotes };
}

if (require.main === module) {
  const { total, lotes } = analizar();
  console.log(`Lotes de fondo (excluidos agregados, EXISTS y búsquedas por clave): ${total}`);
  console.log(`  sin tope: ${lotes.length}`);
  console.log('');

  const porFichero: Record<string, number> = {};
  for (const l of lotes) porFichero[l.fichero] = (porFichero[l.fichero] ?? 0) + 1;

  for (const [f, n] of Object.entries(porFichero).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${f}`);
  }
  console.log('');
  for (const l of lotes) console.log(`  ${l.fichero} → FROM ${l.tabla}`);
}
