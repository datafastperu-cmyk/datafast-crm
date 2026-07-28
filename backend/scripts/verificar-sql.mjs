// Barrido de queries crudas contra el esquema real de producción.
//
// Motivo (2026-07-28): dos consumidores huérfanos de migraciones de esquema encontrados
// el mismo día — `em.serie_boleta` (cron de facturación, fallando a diario en silencio)
// y `o.tr069_acs_username`. Ambos son columnas que se movieron de tabla y dejaron atrás
// una query cruda. El compilador no las ve: viven dentro de template strings.
//
// Heurística: mapear alias→tabla desde FROM/JOIN y verificar cada `alias.columna`
// contra information_schema. Conservador — solo reporta lo que puede resolver con
// certeza, para que el resultado sea accionable y no una lista de falsos positivos.

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// Uso:
//   1) Volcar el esquema de la BD (una línea por tabla: `tabla:col1,col2,...`):
//        psql -tAc "SELECT table_name || ':' || string_agg(column_name, ',')
//                   FROM information_schema.columns WHERE table_schema='public'
//                   GROUP BY table_name" > /tmp/schema.txt
//   2) node scripts/verificar-sql.mjs /tmp/schema.txt src
//
// Sale con código 1 si encuentra columnas inexistentes → usable como paso de CI.

const SCHEMA_FILE = process.argv[2];
const SRC_DIR     = process.argv[3] ?? 'src';

if (!SCHEMA_FILE) {
  console.error('Uso: node scripts/verificar-sql.mjs <schema.txt> [src]');
  process.exit(2);
}

// ── Esquema real ───────────────────────────────────────────────
const tablas = new Map(); // tabla -> Set(columnas)
for (const linea of readFileSync(SCHEMA_FILE, 'utf8').split('\n')) {
  const i = linea.indexOf(':');
  if (i < 0) continue;
  const tabla = linea.slice(0, i).trim();
  if (!tabla) continue;
  tablas.set(tabla, new Set(linea.slice(i + 1).trim().split(',').map((c) => c.trim())));
}

// ── Recolectar archivos ────────────────────────────────────────
const archivos = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!p.endsWith('.ts') || p.endsWith('.spec.ts')) continue;
    // Las migraciones referencian a propósito columnas que crean o borran.
    if (p.includes('migrations')) continue;
    archivos.push(p);
  }
})(SRC_DIR);

// ── Extraer SQL de template literals ───────────────────────────
const SQL_RE = /`([^`]*?(?:SELECT|UPDATE|INSERT\s+INTO|DELETE\s+FROM)[\s\S]*?)`/gi;

const hallazgos = [];
let sqlAnalizados = 0;

for (const archivo of archivos) {
  const src = readFileSync(archivo, 'utf8');
  const lineas = src.split('\n');

  for (const m of src.matchAll(SQL_RE)) {
    // Los comentarios SQL se eliminan ANTES de analizar: suelen explicar justamente qué
    // columna se quitó y por qué, y sin esto el script se denuncia a sí mismo.
    const sql = m[1].replace(/--[^\n]*/g, '');
    if (!/\b(FROM|UPDATE|INSERT\s+INTO)\b/i.test(sql)) continue;
    sqlAnalizados++;

    const linea = src.slice(0, m.index).split('\n').length;

    // alias -> tabla  (FROM tabla alias | JOIN tabla alias | FROM tabla AS alias)
    const alias = new Map();
    for (const t of sql.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_][a-z0-9_]*)\s+(?:AS\s+)?([a-z][a-z0-9_]*)\b/gi)) {
      const [, tabla, al] = t;
      const kw = ['on','where','set','values','group','order','limit','using','left','inner','join','select','and','or','as','returning'];
      if (kw.includes(al.toLowerCase())) continue;
      if (tablas.has(tabla)) alias.set(al.toLowerCase(), tabla);
    }
    if (alias.size === 0) continue;

    // PUNTO CIEGO corregido: una query con UNA SOLA tabla y SIN alias no tiene
    // referencias `alias.columna`, así que la pasada de abajo no la veía. Así se escapó
    // `SELECT id, razon_social, igv_rate, serie_boleta FROM empresas` en el worker de
    // facturación — el mismo bug que el barrido venía a cazar.
    const tablasEnSql = [...sql.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_][a-z0-9_]*)/gi)]
      .map((t) => t[1]).filter((t) => tablas.has(t));
    const unicaTabla = new Set(tablasEnSql).size === 1 ? tablasEnSql[0] : null;

    if (unicaTabla && !/\b[a-z][a-z0-9_]*\.[a-z_]/i.test(sql)) {
      const cols = tablas.get(unicaTabla);
      const select = sql.match(/SELECT\s+([\s\S]*?)\s+FROM\b/i)?.[1] ?? '';
      for (const campo of select.split(',')) {
        const col = campo.trim().split(/\s+/)[0].toLowerCase();
        if (!col || col === '*' || !/^[a-z_][a-z0-9_]*$/.test(col)) continue;
        if (['count','sum','max','min','avg','distinct','case','coalesce','cast','now'].includes(col)) continue;
        if (cols.has(col)) continue;
        hallazgos.push({
          archivo: archivo.replace(/\\/g, '/').split('/backend/')[1] ?? archivo,
          linea, tabla: unicaTabla, alias: '(sin alias)', columna: col,
        });
      }
    }

    // referencias alias.columna
    for (const r of sql.matchAll(/\b([a-z][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/gi)) {
      const [, al, col] = r;
      const tabla = alias.get(al.toLowerCase());
      if (!tabla) continue;                    // alias desconocido → no se afirma nada
      if (col === '*') continue;
      const cols = tablas.get(tabla);
      if (cols.has(col)) continue;

      hallazgos.push({
        archivo: archivo.replace(/\\/g, '/').split('/backend/')[1] ?? archivo,
        linea, tabla, alias: al, columna: col,
      });
    }
  }
}

// ── Reporte ────────────────────────────────────────────────────
const unicos = new Map();
for (const h of hallazgos) {
  unicos.set(`${h.archivo}:${h.linea}:${h.tabla}.${h.columna}`, h);
}

console.log(`SQL analizados: ${sqlAnalizados} | archivos: ${archivos.length}`);
console.log(`Columnas inexistentes: ${unicos.size}\n`);
for (const h of [...unicos.values()].sort((a, b) => a.archivo.localeCompare(b.archivo))) {
  console.log(`${h.archivo}:${h.linea}  ${h.tabla}.${h.columna}   (alias "${h.alias}")`);
}

// Código de salida distinto de 0 para que CI falle: el valor de este script está en
// bloquear el merge, no en informar después de que el cron llevaba días roto.
process.exit(unicos.size > 0 ? 1 : 0);
