import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(process.cwd(), '.env.production') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

/**
 * Genera el informe de un DOMINIO cruzando dos fuentes que normalmente no se miran juntas:
 * la **base de datos real** (tablas, claves foráneas, disparadores, volumen) y el **código**
 * (quién escribe, quién lee, qué servicios, qué endpoints, qué jobs).
 *
 * Existe porque un informe escrito a mano envejece el día que alguien añade una tabla, y porque
 * las dos preguntas que de verdad importan —«¿quién escribe esto?» y «¿quién lo lee?»— no se
 * pueden responder mirando solo un lado. El esquema no sabe quién lo toca; el código no sabe qué
 * existe de verdad en producción.
 *
 * Uso, desde `backend/` en el servidor:
 *
 *     npx ts-node -T src/common/analisis/informe-dominio.ts clientes contratos servicios
 *
 * Sin argumentos toma el dominio del abonado. El informe sale por stdout en Markdown.
 */

// ── Análisis del código ─────────────────────────────────────────────────────
const ficheros: string[] = [];
(function recorrer(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'migrations') recorrer(p); }
    else if (e.name.endsWith('.ts') && !e.name.includes('.spec.')) ficheros.push(p);
  }
})('src');

const sinComentarios = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const moduloDe = (f: string): string =>
  (/src[\\/]modules[\\/]([^\\/]+)[\\/]/.exec(f) || [, 'common'])[1] as string;

interface Toque { modulo: string; fichero: string }

const escriben: Record<string, Toque[]> = {};
const leen: Record<string, Toque[]> = {};
const entidadDe: Record<string, string> = {};
const jobs: Array<{ modulo: string; tipo: string; nombre: string; tablas: Set<string> }> = [];
const endpoints: Array<{ modulo: string; verbo: string; ruta: string; base: string }> = [];

for (const f of ficheros) {
  const s = sinComentarios(fs.readFileSync(f, 'utf8'));
  const mod = moduloDe(f);
  const rel = path.relative('src', f).split(path.sep).join('/');

  // Entidades TypeORM: @Entity('tabla')
  for (const [, tabla] of s.matchAll(/@Entity\('(\w+)'\)/g)) entidadDe[tabla] = rel;

  // Escrituras y lecturas en SQL crudo
  for (const [, , tabla] of s.matchAll(/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(\w+)/gi)) {
    (escriben[tabla.toLowerCase()] ??= []).push({ modulo: mod, fichero: rel });
  }
  for (const [, tabla] of s.matchAll(/\bFROM\s+(\w+)/gi)) {
    (leen[tabla.toLowerCase()] ??= []).push({ modulo: mod, fichero: rel });
  }

  // Jobs: crons y procesadores de cola
  for (const [, expr] of s.matchAll(/@Cron\(([^)]*)\)/g)) {
    const nombre = (/name:\s*'([^']+)'/.exec(expr) || [, expr.slice(0, 40)])[1] as string;
    jobs.push({ modulo: mod, tipo: 'cron', nombre, tablas: new Set() });
  }
  for (const [, nombre] of s.matchAll(/@Process\(\{?\s*name:\s*(?:JOBS\.)?(\w+)/g)) {
    jobs.push({ modulo: mod, tipo: 'cola', nombre, tablas: new Set() });
  }
  for (const [, nombre] of s.matchAll(/addCronJob\('([^']+)'/g)) {
    jobs.push({ modulo: mod, tipo: 'cron', nombre, tablas: new Set() });
  }

  // Endpoints
  const base = (/@Controller\('([^']*)'\)/.exec(s) || [, ''])[1] as string;
  if (/@Controller\(/.test(s)) {
    for (const [, verbo, ruta] of s.matchAll(/@(Get|Post|Patch|Put|Delete)\(\s*'?([^')]*)'?\s*\)/g)) {
      endpoints.push({ modulo: mod, verbo: verbo.toUpperCase(), ruta, base });
    }
  }
}

const unicos = (t: Toque[] = []) => [...new Set(t.map((x) => x.modulo))].sort();

// El dueño NO se deduce del código: se lee del manifiesto de PA-12, que es donde está
// declarado. Deducirlo (p.ej. «el primero que escribe») produciría un dato con aspecto de
// hallazgo que en realidad es un orden alfabético. Lo que sí aporta el código es el CONTRASTE:
// quién escribe de verdad frente a quién debería.
const manifiesto = fs.readFileSync('src/common/domain/propiedad-tablas.ts', 'utf8');
const dueno: Record<string, string> = {};
for (const [, tabla, d] of manifiesto.matchAll(/^\s*(\w+):\s*\{[^}]*dueno:\s*'([^']+)'/gm)) {
  dueno[tabla] = d;
}

// ── Introspección de la base ────────────────────────────────────────────────
async function main() {
  const semillas = process.argv.slice(2).length
    ? process.argv.slice(2)
    : ['clientes', 'contratos', 'servicios', 'servicios_historial'];

  // Mismas variables que `config/datasource.ts` — un solo contrato de conexión.
  const c = new Client({
    host: process.env.DATABASE_HOST || process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || process.env.DB_PORT, 10) || 5432,
    database: process.env.DATABASE_NAME || process.env.DB_NAME || 'datafast_db',
    user: process.env.DATABASE_USER || process.env.DB_USER || 'datafast_db_user',
    password: process.env.DATABASE_PASSWORD || process.env.DB_PASSWORD,
  });
  await c.connect();

  const fks = (await c.query<{
    tabla: string; columna: string; ref_tabla: string; ref_columna: string; borrado: string;
  }>(`
    SELECT tc.table_name AS tabla, kcu.column_name AS columna,
           ccu.table_name AS ref_tabla, ccu.column_name AS ref_columna,
           rc.delete_rule AS borrado
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
      JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
  `)).rows;

  // El dominio = semillas + todo lo que las referencia (un salto).
  const dominio = new Set(semillas);
  for (const fk of fks) if (dominio.has(fk.ref_tabla)) dominio.add(fk.tabla);

  const tablas = [...dominio].sort();

  const meta = (await c.query<{ tabla: string; columnas: string }>(`
    SELECT table_name AS tabla, COUNT(*)::text AS columnas
      FROM information_schema.columns WHERE table_name = ANY($1) GROUP BY table_name
  `, [tablas])).rows;
  const columnasDe = Object.fromEntries(meta.map((m) => [m.tabla, m.columnas]));

  const disparadores = (await c.query<{ tabla: string; nombre: string; evento: string }>(`
    SELECT event_object_table AS tabla, trigger_name AS nombre,
           string_agg(DISTINCT event_manipulation, '/') AS evento
      FROM information_schema.triggers WHERE event_object_table = ANY($1)
     GROUP BY 1, 2
  `, [tablas])).rows;

  const filas: Record<string, number> = {};
  for (const t of tablas) {
    try {
      const r = await c.query(`SELECT COUNT(*)::int AS n FROM "${t}"`);
      filas[t] = r.rows[0].n;
    } catch { filas[t] = -1; }
  }
  await c.end();

  // ── Informe ───────────────────────────────────────────────────────────────
  const L: string[] = [];
  const p = (s = '') => L.push(s);

  p(`# Informe de dominio — ${semillas.join(', ')}`);
  p();
  p(`Generado por \`informe-dominio.ts\` el ${new Date().toISOString().slice(0, 10)}.`);
  p(`Cruza la base real (${tablas.length} tablas) con el análisis del código.`);
  p();
  p('## 1. Tablas del dominio');
  p();
  p('Dueño = lo declarado en el manifiesto de PA-12. Escriben/Leen = lo medido en el código.');
  p();
  p('| Tabla | Filas | Cols | Entidad TypeORM | Dueño (PA-12) | Escriben de hecho | Leen |');
  p('|---|---:|---:|---|---|---|---|');
  for (const t of tablas) {
    const w = unicos(escriben[t]);
    const r = unicos(leen[t]).filter((m) => !w.includes(m));
    const d = dueno[t];
    // Un escritor que no es el dueño se marca aquí mismo: es la lectura que importa.
    const escritores = w.map((m) => (d && m !== d ? `**${m}**` : m));
    p(`| \`${t}\` | ${filas[t] < 0 ? '?' : filas[t]} | ${columnasDe[t] ?? '?'} | ${entidadDe[t] ? '`' + entidadDe[t] + '`' : '**ninguna**'} | ${d ?? '_sin declarar_'} | ${escritores.join(', ') || '—'} | ${r.join(', ') || '—'} |`);
  }
  p();
  p('En negrita, el módulo que escribe una tabla que no le pertenece.');

  const sinDeclarar = tablas.filter((t) => !dueno[t]);
  if (sinDeclarar.length) {
    p();
    p(`**${sinDeclarar.length} tablas del dominio no están en el manifiesto de PA-12** — quedan`);
    p('fuera del barrido de escritores y pierden la garantía en silencio: ' +
      sinDeclarar.map((t) => `\`${t}\``).join(', ') + '.');
  }

  const sinEntidad = tablas.filter((t) => !entidadDe[t]);
  if (sinEntidad.length) {
    p();
    p(`**${sinEntidad.length} tablas sin entidad TypeORM** — solo se tocan por SQL crudo, así que`);
    p('ningún tipo protege sus columnas: ' + sinEntidad.map((t) => `\`${t}\``).join(', ') + '.');
  }

  p();
  p('## 2. Claves foráneas');
  p();
  p('| Desde | Columna | Hacia | Al borrar |');
  p('|---|---|---|---|');
  for (const fk of fks.filter((f) => dominio.has(f.tabla) || dominio.has(f.ref_tabla))
                      .sort((a, b) => a.tabla.localeCompare(b.tabla))) {
    p(`| \`${fk.tabla}\` | ${fk.columna} | \`${fk.ref_tabla}\`.${fk.ref_columna} | ${fk.borrado} |`);
  }

  p();
  p('## 3. Escritores múltiples — las tablas sin dueño único de hecho');
  p();
  const multiples = tablas.filter((t) => unicos(escriben[t]).length > 1)
                          .sort((a, b) => unicos(escriben[b]).length - unicos(escriben[a]).length);
  if (!multiples.length) p('_Ninguna._');
  for (const t of multiples) {
    const w = unicos(escriben[t]);
    const ajenos = dueno[t] ? w.filter((m) => m !== dueno[t]) : w;
    p(`- \`${t}\` — **${w.length} módulos escriben**; dueño declarado: ${dueno[t] ?? '_ninguno_'}. ` +
      `Ajenos: ${ajenos.join(', ') || '—'}`);
  }

  p();
  p('## 4. Disparadores en la base');
  p();
  if (!disparadores.length) p('_Ninguno._');
  for (const d of disparadores) p(`- \`${d.tabla}\` → **${d.nombre}** (${d.evento})`);

  p();
  p('## 5. Endpoints del dominio');
  p();
  const modsDominio = new Set(tablas.flatMap((t) => unicos(escriben[t])));
  const eps = endpoints.filter((e) => modsDominio.has(e.modulo));
  p(`${eps.length} endpoints en ${new Set(eps.map((e) => e.modulo)).size} módulos.`);
  p();
  for (const mod of [...new Set(eps.map((e) => e.modulo))].sort()) {
    const propios = eps.filter((e) => e.modulo === mod);
    const mut = propios.filter((e) => e.verbo !== 'GET').length;
    p(`- **${mod}** — ${propios.length} endpoints (${mut} mutantes), base \`/${propios[0].base}\``);
  }

  p();
  p('## 6. Jobs y crons que tocan el dominio');
  p();
  for (const mod of [...new Set(jobs.filter((j) => modsDominio.has(j.modulo)).map((j) => j.modulo))].sort()) {
    const propios = jobs.filter((j) => j.modulo === mod);
    p(`- **${mod}** — ${propios.map((j) => `\`${j.nombre}\` (${j.tipo})`).join(', ')}`);
  }

  console.log(L.join('\n'));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
