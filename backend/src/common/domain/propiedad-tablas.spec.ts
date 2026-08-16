import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PROPIEDAD_TABLAS, TECHO_TABLAS_COMPARTIDAS, TECHO_TABLAS_COMPARTIDAS_ORM } from './propiedad-tablas';
import { escritoresPorTabla as escritoresPorTablaCompleto } from '../analisis/escritores-tabla';

// ═══════════════════════════════════════════════════════════════════════════
// La barrera de ADR-032 / PA-12.
//
// «Cada tabla tiene un módulo que la escribe» llevaba escrito desde la emisión del corpus y
// no impidió que diez módulos escribieran `contratos`. Una política sin mecanismo es una
// estadística — la misma lección que el latido (ADR-020) y la deuda (ADR-019).
//
// Este test NO exige que las 15 tablas compartidas se arreglen hoy: las congela. Lo que
// impide es la número 16, y un escritor nuevo sobre una tabla ya declarada.
//
// Solo ve SQL crudo (ver el límite declarado en `propiedad-tablas.ts`).
// ═══════════════════════════════════════════════════════════════════════════
describe('Una tabla, un dueño (ADR-032 · PA-12)', () => {
  const SRC = join(__dirname, '..', '..');

  const ficherosTs = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
      if (e === 'node_modules' || e === 'dist') continue;
      const r = join(dir, e);
      if (statSync(r).isDirectory()) { out.push(...ficherosTs(r)); continue; }
      if (e.endsWith('.ts') && !e.endsWith('.spec.ts')) out.push(r);
    }
    return out;
  };

  /** tabla → módulos que la ESCRIBEN (INSERT / UPDATE / DELETE) en SQL crudo. */
  const escritoresPorTabla = (): Map<string, Set<string>> => {
    const mapa = new Map<string, Set<string>>();

    for (const fichero of ficherosTs(SRC)) {
      const rel = fichero.slice(SRC.length + 1).split('\\').join('/');
      // Las migraciones DEFINEN el esquema; no son escritores de negocio.
      if (rel.startsWith('database/migrations/')) continue;

      const m = /^modules\/([^/]+)\//.exec(rel);
      const modulo = m ? m[1] : (rel.startsWith('common/') ? 'common' : 'raiz');
      const src = readFileSync(fichero, 'utf8');

      for (const lit of src.matchAll(/`([^`]*)`/g)) {
        for (const patron of [
          /\bINSERT\s+INTO\s+"?([a-z_0-9]+)"?/gi,
          /\bUPDATE\s+"?([a-z_0-9]+)"?\s+SET/gi,
          /\bDELETE\s+FROM\s+"?([a-z_0-9]+)"?/gi,
        ]) {
          for (const t of lit[1].matchAll(patron)) {
            const tabla = t[1].toLowerCase();
            if (!mapa.has(tabla)) mapa.set(tabla, new Set());
            mapa.get(tabla)!.add(modulo);
          }
        }
      }
    }
    return mapa;
  };

  it('ninguna tabla declarada gana un escritor que el manifiesto no reconozca', () => {
    const reales = escritoresPorTabla();
    const nuevos: string[] = [];

    for (const [tabla, decl] of Object.entries(PROPIEDAD_TABLAS)) {
      const permitidos = new Set([decl.dueno, ...(decl.infractores ?? [])]);
      // Una excepción justificada cubre a cualquier escritor: es diseño, no deuda.
      if (decl.excepcion && !decl.infractores) continue;

      for (const modulo of reales.get(tabla) ?? []) {
        if (!permitidos.has(modulo)) nuevos.push(`${tabla} ← ${modulo}`);
      }
    }

    // Si esto falla: o el módulo no debía escribir esa tabla (usa la capacidad de su dueño),
    // o la propiedad está mal declarada. Añadirlo a `infractores` sin más NO es la salida:
    // la lista puede bajar, nunca subir (ADR-032 §4.4).
    expect(nuevos).toEqual([]);
  });

  it('el número de tablas con varios escritores no sube del techo congelado', () => {
    const reales = escritoresPorTabla();
    const compartidas = [...reales.entries()]
      .filter(([, mods]) => mods.size > 1)
      .map(([t]) => t)
      .sort();

    expect(compartidas.length).toBeLessThanOrEqual(TECHO_TABLAS_COMPARTIDAS);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Segundo techo — misma pregunta, instrumento completo (SQL en cualquier parte del
  // archivo + ORM). Hallazgo Ola 0: 20, no 15. Que un instrumento más barato vea menos no
  // vuelve inexistente lo que el instrumento completo sí ve — dos cifras para la misma
  // realidad están bien; que la baja tape a la alta, no (revisión Ola 0, 2026-08-16).
  //
  // DIVERGENCIA DECLARADA respecto de ADR-032 §4.4 ("puede bajar, nunca subir"): este test
  // falla en LAS DOS direcciones, no solo al subir. Es a propósito — ver F-0.1-A §7, regla 7.
  // ═══════════════════════════════════════════════════════════════════════════
  it('el número de tablas con varios escritores (SQL+ORM) es exactamente el techo congelado', () => {
    const SRC = join(__dirname, '..', '..');
    const reales = escritoresPorTablaCompleto(SRC);
    const compartidas = [...reales.entries()]
      .filter(([, mods]) => mods.size > 1)
      .map(([t]) => t)
      .sort();

    // Ni más (regresión) ni menos (techo obsoleto — hay que recongelar en el número nuevo,
    // no dejar que la cifra vieja siga citándose).
    expect(compartidas.length).toBe(TECHO_TABLAS_COMPARTIDAS_ORM);
  });

  // Un `infractor` que ya no infringe es ruido que hace el manifiesto menos creíble, y
  // además esconde el progreso: si nadie retira las entradas resueltas, la lista nunca baja.
  it('el manifiesto no arrastra infractores que ya se corrigieron', () => {
    const reales = escritoresPorTabla();
    const fantasmas: string[] = [];

    for (const [tabla, decl] of Object.entries(PROPIEDAD_TABLAS)) {
      const actuales = reales.get(tabla) ?? new Set<string>();
      for (const inf of decl.infractores ?? []) {
        if (!actuales.has(inf)) fantasmas.push(`${tabla}: '${inf}' ya no la escribe — retirar`);
      }
    }

    expect(fantasmas).toEqual([]);
  });

  it('toda excepción lleva su motivo escrito', () => {
    const sinMotivo = Object.entries(PROPIEDAD_TABLAS)
      .filter(([, d]) => d.excepcion !== undefined && d.excepcion.trim().length < 40)
      .map(([t]) => t);

    // Una excepción sin motivo es un permiso silencioso: el siguiente lector la da por buena.
    expect(sinMotivo).toEqual([]);
  });
});
