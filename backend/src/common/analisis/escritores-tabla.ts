import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * Detección real de quién escribe cada tabla — SQL crudo (en cualquier parte del código, no
 * solo en backticks) **y** ORM inyectado (`@InjectRepository` + `this.xRepo.save()`,
 * `manager.getRepository(X).save()`). Es la misma lógica que usaba `inventario-bloque.ts`
 * para su informe — vive aquí como función pura (sin conexión a BD) para que
 * `inventario-bloque.ts` y las barreras de PA-12 midan con **el mismo instrumento**. Dos
 * sitios calculando lo mismo con regex parecidas-pero-no-iguales es el defecto que ADR-032
 * existe para impedir (el mismo patrón, un nivel más arriba de las 15 tablas).
 *
 * Deliberadamente MÁS AMPLIA que la barrera clásica de `propiedad-tablas.spec.ts` (que solo
 * ve `INSERT/UPDATE/DELETE` dentro de literales de plantilla con backtick, y sigue viva a
 * propósito: es barata y corre en cada `npm test`). Esta es la foto completa —ORM-aware—,
 * usada donde el coste de recorrer más regex por archivo es aceptable: el informe de
 * `inventario-bloque.ts` y la barrera ampliada de `propiedad-tablas.spec.ts`
 * (hallazgo Ola 0, F-0.1-A §6).
 *
 * LÍMITE DECLARADO: un `getRepository()` dinámico fuera de los dos patrones reconocidos, o un
 * nombre de tabla construido en tiempo de ejecución, no se ve. Sigue siendo un SUELO, no un
 * total.
 */

export interface EscrituraTabla {
  modulo: string;
  tabla: string;
  operacion: string;
  fichero: string;
  linea: number;
  via: 'SQL' | 'ORM';
}

const OPS_ORM = 'save|insert|update|upsert|delete|remove|softDelete|softRemove|restore|increment|decrement';

export function ficherosTs(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'dist' || e === 'migrations') continue;
    const r = join(dir, e);
    if (statSync(r).isDirectory()) { out.push(...ficherosTs(r)); continue; }
    if (e.endsWith('.ts') && !e.endsWith('.spec.ts')) out.push(r);
  }
  return out;
}

export const sinComentarios = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

export function moduloDe(srcDir: string, fichero: string): string {
  const rel = relative(srcDir, fichero).split(sep).join('/');
  const m = /^modules\/([^/]+)\//.exec(rel);
  return m ? m[1] : (rel.startsWith('common/') ? 'common' : 'raiz');
}

/** Mapa entidad TS → nombre de tabla, leído de los decoradores `@Entity('tabla')`. */
export function tablaDeEntidad(ficheros: string[]): Record<string, string> {
  const mapa: Record<string, string> = {};
  for (const f of ficheros) {
    const s = readFileSync(f, 'utf8');
    for (const [, tabla, clase] of s.matchAll(/@Entity\('(\w+)'\)[\s\S]{0,300}?export class (\w+)/g)) {
      mapa[clase] = tabla;
    }
  }
  return mapa;
}

/** Todas las escrituras detectadas (SQL crudo + ORM), con módulo, archivo y línea. */
export function escrituras(srcDir: string, ficheros: string[], entidadATabla: Record<string, string>): EscrituraTabla[] {
  const out: EscrituraTabla[] = [];

  for (const f of ficheros) {
    const s = sinComentarios(readFileSync(f, 'utf8'));
    const mod = moduloDe(srcDir, f);
    const rel = relative(srcDir, f).split(sep).join('/');
    const lineaDe = (i: number) => s.slice(0, i).split('\n').length;

    // El `(?<!\bFOR\s+)` evita leer `FOR UPDATE SKIP LOCKED` como escritura a una tabla `skip`.
    // El `(?!\s+SET\b)` tras UPDATE evita leer `ON CONFLICT (...) DO UPDATE SET col = ...`
    // (el upsert de Postgres) como escritura a una tabla `set` — falso positivo real,
    // encontrado en la Ola 0 al construir esta barrera (`watcher-heartbeat.service.ts` entre
    // otros). La barrera SQL-cruda de `propiedad-tablas.spec.ts` no lo sufría por casualidad:
    // su regex exige un `SET` posterior al nombre capturado, y `SET SET` no ocurre.
    for (const m of s.matchAll(/(?<!\bFOR\s+)\b(INSERT\s+INTO|UPDATE(?!\s+SET\b)|DELETE\s+FROM)\s+(\w+)/gi)) {
      const op = m[1].toUpperCase().split(/\s+/)[0];
      out.push({ modulo: mod, tabla: m[2].toLowerCase(), operacion: op, fichero: rel, linea: lineaDe(m.index!), via: 'SQL' });
    }

    // `@InjectRepository(X) private xRepo` → `this.xRepo.save(`.
    const tablaDeProp: Record<string, string> = {};
    for (const [, entidad, prop] of s.matchAll(/@InjectRepository\((\w+)\)[^,)]*?(\w+):\s*Repository/g)) {
      if (entidadATabla[entidad]) tablaDeProp[prop] = entidadATabla[entidad];
    }
    for (const m of s.matchAll(new RegExp(`\\bthis\\.(\\w+)\\.(${OPS_ORM})\\(`, 'g'))) {
      const tabla = tablaDeProp[m[1]];
      if (tabla) out.push({ modulo: mod, tabla, operacion: m[2], fichero: rel, linea: lineaDe(m.index!), via: 'ORM' });
    }
    // `manager.getRepository(Entidad).save(...)` — el caso transaccional.
    for (const m of s.matchAll(new RegExp(`getRepository\\((\\w+)\\)\\s*\\.\\s*(${OPS_ORM})\\(`, 'g'))) {
      const tabla = entidadATabla[m[1]];
      if (tabla) out.push({ modulo: mod, tabla, operacion: m[2], fichero: rel, linea: lineaDe(m.index!), via: 'ORM' });
    }
  }

  return out;
}

/** tabla → módulos que la ESCRIBEN, vía SQL crudo (cualquier parte del archivo) u ORM. */
export function escritoresPorTabla(srcDir: string): Map<string, Set<string>> {
  const ficheros = ficherosTs(srcDir);
  const entidadATabla = tablaDeEntidad(ficheros);
  const mapa = new Map<string, Set<string>>();
  for (const e of escrituras(srcDir, ficheros, entidadATabla)) {
    if (!mapa.has(e.tabla)) mapa.set(e.tabla, new Set());
    mapa.get(e.tabla)!.add(e.modulo);
  }
  return mapa;
}
