import * as fs from 'fs';
import * as path from 'path';

/**
 * Acoplamiento REAL entre módulos, no el grafo de imports.
 *
 * Un `import` puede ser un tipo, un enum o una constante: no significa que un módulo llame a otro.
 * Lo que sí lo significa son dos cosas medibles:
 *
 *   1. **Inyección de dependencia** — un servicio en el constructor de otro es una llamada real
 *      en tiempo de ejecución, con acoplamiento de arranque: si el proveedor no está, el módulo
 *      no levanta.
 *   2. **Escritura a una tabla ajena** — un módulo que hace `INSERT`/`UPDATE`/`DELETE` sobre la
 *      tabla de otro se salta su dueño, aunque no lo importe nunca.
 *
 * La segunda es la que no aparece en ningún diagrama de imports y la que más cuesta cuando se
 * quiere separar un módulo: el código se lleva, la tabla no.
 */

export interface Arista { desde: string; hacia: string; via: string }

const MODULO = /src[\\/]modules[\\/]([^\\/]+)[\\/]/;

const ficheros: string[] = [];
(function recorrer(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'migrations') recorrer(p); }
    else if (e.name.endsWith('.ts') && !e.name.includes('.spec.')) ficheros.push(p);
  }
})('src');

const moduloDe = (f: string): string | null => (MODULO.exec(f) || [, null])[1] as string | null;

const sinComentarios = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

// ── 1. Inyecciones: quién llama a quién ─────────────────────────────────────
const inyecciones: Arista[] = [];
const servicioA: Record<string, string> = {};

for (const f of ficheros) {
  const m = moduloDe(f);
  if (!m) continue;
  for (const [, clase] of sinComentarios(fs.readFileSync(f, 'utf8')).matchAll(/export class (\w+Service)\b/g)) {
    servicioA[clase] = m;
  }
}

for (const f of ficheros) {
  const desde = moduloDe(f);
  if (!desde) continue;
  const s = sinComentarios(fs.readFileSync(f, 'utf8'));
  const ctor = /constructor\s*\(([\s\S]*?)\)\s*\{/.exec(s);
  if (!ctor) continue;
  for (const [, clase] of ctor[1].matchAll(/:\s*(\w+Service)\b/g)) {
    const hacia = servicioA[clase];
    if (hacia && hacia !== desde) inyecciones.push({ desde, hacia, via: clase });
  }
}

// ── 2. Escrituras a tablas ajenas ───────────────────────────────────────────
// El dueño sale del manifiesto de PA-12, que ya declara quién posee cada tabla.
const manifiesto = fs.readFileSync('src/common/domain/propiedad-tablas.ts', 'utf8');
const dueno: Record<string, string> = {};
for (const [, tabla, d] of manifiesto.matchAll(/^\s*(\w+):\s*\{[^}]*dueno:\s*'([^']+)'/gm)) {
  dueno[tabla] = d;
}

const escrituras: Arista[] = [];
for (const f of ficheros) {
  const desde = moduloDe(f);
  if (!desde) continue;
  const s = sinComentarios(fs.readFileSync(f, 'utf8'));
  for (const [, , tabla] of s.matchAll(/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(\w+)/gi)) {
    const d = dueno[tabla.toLowerCase()];
    if (d && d !== desde) escrituras.push({ desde, hacia: d, via: tabla.toLowerCase() });
  }
}

// ── Informe ─────────────────────────────────────────────────────────────────
const agrupar = (aristas: Arista[]) => {
  const g: Record<string, Record<string, Set<string>>> = {};
  for (const a of aristas) {
    ((g[a.desde] ??= {})[a.hacia] ??= new Set()).add(a.via);
  }
  return g;
};

if (require.main === module) {
  const gi = agrupar(inyecciones);
  console.log('══ LLAMA A (inyección de dependencia) ══\n');
  for (const desde of Object.keys(gi).sort()) {
    const destinos = Object.entries(gi[desde]).sort();
    console.log(`${desde}  →  ${destinos.map(([h, v]) => `${h}(${v.size})`).join('  ')}`);
  }

  const ge = agrupar(escrituras);
  console.log('\n══ ESCRIBE EN TABLA AJENA ══\n');
  for (const desde of Object.keys(ge).sort()) {
    for (const [hacia, tablas] of Object.entries(ge[desde]).sort()) {
      console.log(`${desde}  →  ${hacia}: ${[...tablas].sort().join(', ')}`);
    }
  }

  // Ciclos de dos: A llama a B y B llama a A.
  console.log('\n══ CICLOS (se llaman mutuamente) ══\n');
  const vistos = new Set<string>();
  for (const a of Object.keys(gi)) {
    for (const b of Object.keys(gi[a])) {
      if (gi[b]?.[a] && !vistos.has(`${b}|${a}`)) {
        vistos.add(`${a}|${b}`);
        console.log(`${a}  ⇄  ${b}`);
      }
    }
  }

  console.log(`\ninyecciones entre módulos: ${inyecciones.length}`);
  console.log(`escrituras a tabla ajena:  ${escrituras.length}`);
}
