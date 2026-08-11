import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(process.cwd(), '.env.production') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

/**
 * Inventario técnico de un BLOQUE del ERP (E-0.1-A…E), generado, no escrito.
 *
 * Cruza la base real —columnas, PK, FK, índices, enums, disparadores, volumen— con el código
 * —quién escribe cada tabla, con qué operación y desde qué archivo; qué servicios existen, de
 * quién dependen, qué endpoints exponen y qué jobs corren—.
 *
 * Ninguna de las dos fuentes responde sola: el esquema no sabe quién lo toca y el código no sabe
 * qué existe de verdad en producción. Un inventario escrito a mano envejece el día que alguien
 * añade una columna; éste se vuelve a correr.
 *
 *     npm run inventario -- A            # Core comercial
 *     npm run inventario -- A --out docs/gobierno/inventario/E-0.1-A.md
 *
 * LÍMITES DECLARADOS, para no confundir un suelo con un total:
 *   · Las escrituras se detectan en SQL crudo y en repositorios TypeORM inyectados por
 *     `@InjectRepository`. Un `getRepository()` dinámico o un `query()` construido por partes
 *     no se ven.
 *   · La «responsabilidad» de un módulo se DERIVA (tablas que escribe, ruta que expone). No es
 *     una descripción de negocio: eso lo escribe una persona.
 */

// ── Bloques ─────────────────────────────────────────────────────────────────
interface Bloque { nombre: string; semillas: string[]; modulos: string[] }

const BLOQUES: Record<string, Bloque> = {
  A: {
    nombre: 'Core comercial',
    semillas: ['clientes', 'contratos', 'servicios', 'servicios_historial', 'planes',
               'facturas', 'pagos'],
    modulos: ['clientes', 'contratos', 'planes', 'facturacion', 'pagos', 'cobranza',
              'promesas-pago', 'finanzas-opex'],
  },
  B: {
    nombre: 'Red / MikroTik',
    semillas: ['routers', 'segmentos_ipv4', 'ips_asignadas', 'perfiles_pppoe'],
    modulos: ['mikrotik', 'vpn', 'monitoreo'],
  },
  C: {
    nombre: 'OLT / FTTH',
    semillas: ['olt_dispositivos', 'ftth_onu_registro', 'olt_onu_inventario'],
    modulos: ['olt-nativo', 'smartolt', 'aprovisionamiento'],
  },
  D: {
    nombre: 'Planta externa',
    semillas: ['pe_nap', 'pe_mufa', 'pe_splitter', 'pe_fibra_segmento', 'pe_acometida', 'nodos'],
    modulos: ['planta-externa'],
  },
  E: {
    nombre: 'Transversales',
    semillas: ['comandos_red_pendientes', 'usuarios', 'empresas', 'auditoria_logs',
               'eventos_sistema'],
    modulos: ['outbox-red', 'workers', 'auth', 'usuarios', 'config', 'auditoria', 'sistema'],
  },
};

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

const relativo = (f: string) => path.relative('src', f).split(path.sep).join('/');

// Paso 1: entidad → tabla. Hace falta antes de poder leer las escrituras por repositorio.
const tablaDeEntidad: Record<string, string> = {};
const ficheroDeTabla: Record<string, string> = {};
for (const f of ficheros) {
  const s = fs.readFileSync(f, 'utf8');
  for (const [, tabla, clase] of s.matchAll(/@Entity\('(\w+)'\)[\s\S]{0,300}?export class (\w+)/g)) {
    tablaDeEntidad[clase] = tabla;
    ficheroDeTabla[tabla] = relativo(f);
  }
}

// Paso 2: escrituras, servicios, dependencias, endpoints y jobs.
interface Escritura { modulo: string; tabla: string; operacion: string; fichero: string; linea: number; via: 'SQL' | 'ORM' }
interface Servicio { modulo: string; clase: string; fichero: string }
interface Endpoint { modulo: string; verbo: string; ruta: string; controlador: string; metodo: string }
interface Job { modulo: string; tipo: 'cron' | 'cola'; nombre: string; fichero: string }

const escrituras: Escritura[] = [];
const servicios: Servicio[] = [];
const endpoints: Endpoint[] = [];
const jobs: Job[] = [];
const dependencias: Array<{ desde: string; hacia: string; via: string }> = [];
const moduloDeServicio: Record<string, string> = {};

for (const f of ficheros) {
  for (const [, clase] of sinComentarios(fs.readFileSync(f, 'utf8')).matchAll(/export class (\w+Service)\b/g)) {
    moduloDeServicio[clase] = moduloDe(f);
  }
}

const OPS_ORM = 'save|insert|update|upsert|delete|remove|softDelete|softRemove|restore|increment|decrement';

for (const f of ficheros) {
  const bruto = fs.readFileSync(f, 'utf8');
  const s = sinComentarios(bruto);
  const mod = moduloDe(f);
  const rel = relativo(f);
  const lineaDe = (i: number) => s.slice(0, i).split('\n').length;

  for (const [, clase] of s.matchAll(/export class (\w+Service)\b/g)) {
    servicios.push({ modulo: mod, clase, fichero: rel });
  }

  // Dependencias: un servicio en el constructor es una llamada real en ejecución.
  const ctor = /constructor\s*\(([\s\S]*?)\)\s*\{/.exec(s);
  if (ctor) {
    for (const [, clase] of ctor[1].matchAll(/:\s*(\w+Service)\b/g)) {
      const hacia = moduloDeServicio[clase];
      if (hacia && hacia !== mod) dependencias.push({ desde: mod, hacia, via: clase });
    }
  }

  // Escrituras en SQL crudo.
  for (const m of s.matchAll(/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(\w+)/gi)) {
    const op = m[1].toUpperCase().split(/\s+/)[0];
    escrituras.push({ modulo: mod, tabla: m[2].toLowerCase(), operacion: op,
                      fichero: rel, linea: lineaDe(m.index!), via: 'SQL' });
  }

  // Escrituras por repositorio TypeORM: `@InjectRepository(X) private xRepo` → `this.xRepo.save(`.
  const tablaDeProp: Record<string, string> = {};
  for (const [, entidad, prop] of s.matchAll(/@InjectRepository\((\w+)\)[^,)]*?(\w+):\s*Repository/g)) {
    if (tablaDeEntidad[entidad]) tablaDeProp[prop] = tablaDeEntidad[entidad];
  }
  for (const m of s.matchAll(new RegExp(`\\bthis\\.(\\w+)\\.(${OPS_ORM})\\(`, 'g'))) {
    const tabla = tablaDeProp[m[1]];
    if (tabla) escrituras.push({ modulo: mod, tabla, operacion: m[2],
                                 fichero: rel, linea: lineaDe(m.index!), via: 'ORM' });
  }
  // `manager.getRepository(Entidad).save(...)` — el caso transaccional.
  for (const m of s.matchAll(new RegExp(`getRepository\\((\\w+)\\)\\s*\\.\\s*(${OPS_ORM})\\(`, 'g'))) {
    const tabla = tablaDeEntidad[m[1]];
    if (tabla) escrituras.push({ modulo: mod, tabla, operacion: m[2],
                                 fichero: rel, linea: lineaDe(m.index!), via: 'ORM' });
  }

  // Endpoints, con el método que los sirve.
  const ctrl = /@Controller\('([^']*)'\)[\s\S]{0,200}?export class (\w+)/.exec(s);
  if (ctrl) {
    for (const m of s.matchAll(/@(Get|Post|Patch|Put|Delete)\(\s*'?([^')]*)'?\s*\)([\s\S]{0,400}?)\n\s{2}(?:async\s+)?(\w+)\s*\(/g)) {
      endpoints.push({ modulo: mod, verbo: m[1].toUpperCase(),
                       ruta: `/${ctrl[1]}${m[2] ? '/' + m[2] : ''}`.replace(/\/+/g, '/'),
                       controlador: ctrl[2], metodo: m[5] });
    }
  }

  for (const m of s.matchAll(/@Cron\(([^)]*)\)/g)) {
    const nombre = (/name:\s*'([^']+)'/.exec(m[1]) || [, m[1].slice(0, 40)])[1] as string;
    jobs.push({ modulo: mod, tipo: 'cron', nombre, fichero: rel });
  }
  for (const m of s.matchAll(/@Process\(\{?\s*name:\s*(?:JOBS\.)?(\w+)/g)) {
    jobs.push({ modulo: mod, tipo: 'cola', nombre: m[1], fichero: rel });
  }
}

// El dueño se LEE del manifiesto de PA-12; deducirlo del código daría un orden alfabético
// con aspecto de hallazgo.
const dueno: Record<string, string> = {};
for (const [, tabla, d] of fs.readFileSync('src/common/domain/propiedad-tablas.ts', 'utf8')
                             .matchAll(/^\s*(\w+):\s*\{[^}]*dueno:\s*'([^']+)'/gm)) {
  dueno[tabla] = d;
}

// ── Introspección de la base ────────────────────────────────────────────────
interface Columna { tabla: string; nombre: string; tipo: string; udt: string; nulo: string; def: string | null; pos: number }
interface Fk { tabla: string; columna: string; ref_tabla: string; ref_columna: string; borrado: string; nombre: string }

async function main() {
  const clave = (process.argv[2] || 'A').toUpperCase();
  const bloque = BLOQUES[clave];
  if (!bloque) { console.error(`Bloque desconocido: ${clave}. Hay ${Object.keys(BLOQUES).join(', ')}.`); process.exit(1); }
  const salida = (process.argv.includes('--out') && process.argv[process.argv.indexOf('--out') + 1]) || null;

  const c = new Client({
    host: process.env.DATABASE_HOST || process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || process.env.DB_PORT, 10) || 5432,
    database: process.env.DATABASE_NAME || process.env.DB_NAME || 'datafast_db',
    user: process.env.DATABASE_USER || process.env.DB_USER || 'datafast_db_user',
    password: process.env.DATABASE_PASSWORD || process.env.DB_PASSWORD,
  });
  await c.connect();

  const fks: Fk[] = (await c.query(`
    SELECT tc.constraint_name AS nombre, tc.table_name AS tabla, kcu.column_name AS columna,
           ccu.table_name AS ref_tabla, ccu.column_name AS ref_columna, rc.delete_rule AS borrado
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
      JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
  `)).rows;

  // El bloque = semillas + lo que las referencia + lo que escriben sus módulos.
  const dominio = new Set(bloque.semillas);
  for (const fk of fks) if (dominio.has(fk.ref_tabla)) dominio.add(fk.tabla);
  for (const e of escrituras) if (bloque.modulos.includes(e.modulo)) dominio.add(e.tabla);

  const existen: string[] = (await c.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)`,
    [[...dominio]],
  )).rows.map((r: { table_name: string }) => r.table_name);
  const tablas = existen.sort();
  const enDominio = new Set(tablas);

  const columnas: Columna[] = (await c.query(`
    SELECT table_name AS tabla, column_name AS nombre, data_type AS tipo, udt_name AS udt,
           is_nullable AS nulo, column_default AS def, ordinal_position AS pos
      FROM information_schema.columns WHERE table_name = ANY($1) ORDER BY table_name, ordinal_position
  `, [tablas])).rows;

  const pks: Array<{ tabla: string; columnas: string }> = (await c.query(`
    SELECT tc.table_name AS tabla, string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS columnas
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
     WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = ANY($1)
     GROUP BY 1
  `, [tablas])).rows;
  const pkDe = Object.fromEntries(pks.map((p) => [p.tabla, p.columnas]));

  const indices: Array<{ tabla: string; nombre: string; def: string }> = (await c.query(`
    SELECT tablename AS tabla, indexname AS nombre, indexdef AS def
      FROM pg_indexes WHERE schemaname='public' AND tablename = ANY($1) ORDER BY 1, 2
  `, [tablas])).rows;

  const enums: Array<{ tipo: string; valores: string }> = (await c.query(`
    SELECT t.typname AS tipo, string_agg(e.enumlabel, ' · ' ORDER BY e.enumsortorder) AS valores
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      JOIN pg_namespace n ON n.oid = t.typnamespace AND n.nspname='public'
     GROUP BY 1
  `)).rows;
  const valoresEnum = Object.fromEntries(enums.map((e) => [e.tipo, e.valores]));

  const disparadores: Array<{ tabla: string; nombre: string; evento: string; funcion: string }> = (await c.query(`
    SELECT event_object_table AS tabla, trigger_name AS nombre,
           string_agg(DISTINCT event_manipulation, '/') AS evento,
           min(action_statement) AS funcion
      FROM information_schema.triggers WHERE event_object_table = ANY($1) GROUP BY 1, 2
  `, [tablas])).rows;

  const filas: Record<string, number> = {};
  for (const t of tablas) {
    try { filas[t] = (await c.query(`SELECT COUNT(*)::int AS n FROM "${t}"`)).rows[0].n; }
    catch { filas[t] = -1; }
  }
  await c.end();

  // ── Informe ───────────────────────────────────────────────────────────────
  const L: string[] = [];
  const p = (s = '') => L.push(s);
  const esc = (t: string) => escrituras.filter((e) => e.tabla === t);
  const mods = (t: string) => [...new Set(esc(t).map((e) => e.modulo))].sort();

  p(`# E-0.1-${clave} — ${bloque.nombre}`);
  p();
  p(`Generado por \`inventario-bloque.ts\` contra la base de producción el ${new Date().toISOString().slice(0, 10)}.`);
  p(`No se edita a mano: se vuelve a correr con \`npm run inventario -- ${clave}\`.`);
  p();
  p(`**${tablas.length} tablas · ${columnas.length} columnas · ${fks.filter((f) => enDominio.has(f.tabla)).length} claves foráneas · ` +
    `${indices.length} índices · ${servicios.filter((s) => bloque.modulos.includes(s.modulo)).length} servicios NestJS · ` +
    `${endpoints.filter((e) => bloque.modulos.includes(e.modulo)).length} endpoints**`);
  p();
  p('> Límite declarado: las escrituras se detectan en SQL crudo y en repositorios TypeORM');
  p('> inyectados. Son un **suelo**, no un total. La «responsabilidad» de cada módulo está');
  p('> derivada de lo que escribe y expone — no es una descripción de negocio.');

  // ── A. Tablas ──
  p();
  p('## A. Tablas');
  for (const t of tablas) {
    const cols = columnas.filter((x) => x.tabla === t);
    const fksT = fks.filter((x) => x.tabla === t);
    const idxT = indices.filter((x) => x.tabla === t);
    const d = dueno[t];
    p();
    p(`### \`${t}\``);
    p();
    p(`${filas[t] < 0 ? '?' : filas[t]} filas · ${cols.length} columnas · PK: \`${pkDe[t] ?? '—'}\` · ` +
      `dueño PA-12: ${d ?? '**sin declarar**'} · entidad: ${ficheroDeTabla[t] ? `\`${ficheroDeTabla[t]}\`` : '**ninguna**'}`);
    p();
    p('| # | Columna | Tipo | Nulo | Defecto |');
    p('|--:|---|---|---|---|');
    for (const col of cols) {
      const tipo = col.tipo === 'USER-DEFINED' ? `\`${col.udt}\` (enum)` : col.tipo;
      const def = col.def ? `\`${col.def.length > 40 ? col.def.slice(0, 37) + '…' : col.def}\`` : '—';
      p(`| ${col.pos} | ${col.nombre} | ${tipo} | ${col.nulo === 'YES' ? 'sí' : 'NO'} | ${def} |`);
    }
    const enumsT = [...new Set(cols.filter((x) => x.tipo === 'USER-DEFINED').map((x) => x.udt))];
    if (enumsT.length) {
      p();
      p('**Enums:**');
      for (const e of enumsT) p(`- \`${e}\` = ${valoresEnum[e] ?? '_no es enum_'}`);
    }
    if (fksT.length) {
      p();
      p('**Claves foráneas:** ' + fksT.map((f) => `\`${f.columna}\` → \`${f.ref_tabla}\`.${f.ref_columna} (${f.borrado})`).join(' · '));
    }
    if (idxT.length) {
      p();
      p('**Índices:**');
      for (const i of idxT) {
        const cuerpo = i.def.replace(/^CREATE (UNIQUE )?INDEX \w+ ON \w+\.\w+ (USING \w+ )?/, '');
        p(`- \`${i.nombre}\`${/UNIQUE/.test(i.def) ? ' **único**' : ''} — ${cuerpo}`);
      }
    }
    const dispT = disparadores.filter((x) => x.tabla === t);
    if (dispT.length) {
      p();
      p('**Disparadores:** ' + dispT.map((x) => `\`${x.nombre}\` (${x.evento})`).join(' · '));
    }
  }

  // ── B. Relaciones ──
  p();
  p('## B. Relaciones');
  p();
  p('| Desde | Columna | Hacia | Al borrar | Restricción |');
  p('|---|---|---|---|---|');
  for (const f of fks.filter((x) => enDominio.has(x.tabla)).sort((a, b) => a.tabla.localeCompare(b.tabla) || a.columna.localeCompare(b.columna))) {
    p(`| \`${f.tabla}\` | ${f.columna} | \`${f.ref_tabla}\`.${f.ref_columna} | ${f.borrado} | \`${f.nombre}\` |`);
  }

  // Una columna `X_id` que apunta a una tabla que no se llama `X` es un nombre que miente.
  const mienten = fks.filter((f) => {
    if (!enDominio.has(f.tabla)) return false;
    const m = /^(.+)_id$/.exec(f.columna);
    if (!m) return false;
    const r = m[1];
    return f.ref_tabla !== r && f.ref_tabla !== `${r}s` && f.ref_tabla !== `${r}es`;
  });
  p();
  p('### Columnas cuyo nombre no dice a dónde apuntan');
  p();
  if (!mienten.length) p('_Ninguna._');
  else {
    const porPar: Record<string, string[]> = {};
    for (const f of mienten) (porPar[`\`${f.columna}\` → \`${f.ref_tabla}\``] ??= []).push(f.tabla);
    for (const [par, ts] of Object.entries(porPar).sort((a, b) => b[1].length - a[1].length)) {
      p(`- ${par} — ${ts.length}: ${ts.map((x) => `\`${x}\``).join(', ')}`);
    }
  }

  // ── C. Escrituras ──
  p();
  p('## C. Escrituras — módulo → tabla → operación → archivo');
  p();
  p('| Módulo | Tabla | Op | Archivo:línea | Vía | ¿Ajena? |');
  p('|---|---|---|---|---|---|');
  const ordenadas = escrituras
    .filter((e) => enDominio.has(e.tabla))
    .sort((a, b) => a.modulo.localeCompare(b.modulo) || a.tabla.localeCompare(b.tabla) || a.fichero.localeCompare(b.fichero) || a.linea - b.linea);
  for (const e of ordenadas) {
    const ajena = dueno[e.tabla] && dueno[e.tabla] !== e.modulo;
    p(`| ${e.modulo} | \`${e.tabla}\` | ${e.operacion} | \`${e.fichero}\`:${e.linea} | ${e.via} | ${ajena ? '**sí**' : ''} |`);
  }
  p();
  p(`${ordenadas.length} escrituras · ${ordenadas.filter((e) => dueno[e.tabla] && dueno[e.tabla] !== e.modulo).length} sobre tabla ajena.`);

  p();
  p('### Tablas por número de módulos que las escriben');
  p();
  for (const t of tablas.filter((x) => mods(x).length > 1).sort((a, b) => mods(b).length - mods(a).length)) {
    const w = mods(t);
    p(`- \`${t}\` — **${w.length}**; dueño: ${dueno[t] ?? '_ninguno_'}; ajenos: ${w.filter((m) => m !== dueno[t]).join(', ') || '—'}`);
  }

  // ── D. Módulos ──
  p();
  p('## D. Módulos del bloque');
  const enBloque = [...new Set([...bloque.modulos, ...ordenadas.map((e) => e.modulo)])].sort();
  for (const m of enBloque) {
    const svc = servicios.filter((s) => s.modulo === m);
    const escribe = [...new Set(escrituras.filter((e) => e.modulo === m).map((e) => e.tabla))].sort();
    // Tres cubos, no dos: una tabla sin dueño declarado no es propia ni ajena, y si no se
    // nombra desaparece del inventario del módulo aunque el módulo la escriba.
    const propias = escribe.filter((t) => dueno[t] === m);
    const ajenas = escribe.filter((t) => dueno[t] && dueno[t] !== m);
    const huerfanas = escribe.filter((t) => !dueno[t]);
    const deps = [...new Set(dependencias.filter((d) => d.desde === m).map((d) => d.hacia))].sort();
    const usanme = [...new Set(dependencias.filter((d) => d.hacia === m).map((d) => d.desde))].sort();
    const eps = endpoints.filter((e) => e.modulo === m);
    p();
    p(`### \`${m}\``);
    p();
    if (!fs.existsSync(path.join('src/modules', m))) {
      p(`**No existe como módulo.** No hay \`src/modules/${m}/\`: lo que el bloque llama «${m}»`);
      p('vive repartido en otros módulos. Es un hallazgo del inventario, no un vacío del informe.');
      continue;
    }
    p(`- **Servicios** (${svc.length}): ${svc.map((s) => `\`${s.clase}\``).join(', ') || '—'}`);
    p(`- **Escribe (propias)**: ${propias.map((t) => `\`${t}\``).join(', ') || '—'}`);
    p(`- **Escribe (ajenas)**: ${ajenas.map((t) => `\`${t}\` (de ${dueno[t]})`).join(', ') || '—'}`);
    p(`- **Escribe (sin dueño declarado)**: ${huerfanas.map((t) => `\`${t}\``).join(', ') || '—'}`);
    p(`- **Depende de**: ${deps.join(', ') || '—'}`);
    p(`- **Le llaman**: ${usanme.join(', ') || '—'}`);
    p(`- **Expone**: ${eps.length} endpoints${eps.length ? ` en \`${[...new Set(eps.map((e) => e.ruta.split('/').slice(0, 2).join('/')))].join(', ')}\`` : ''}`);
  }

  // ── E. Endpoints ──
  p();
  p('## E. Endpoints');
  for (const m of enBloque) {
    const eps = endpoints.filter((e) => e.modulo === m);
    if (!eps.length) continue;
    p();
    p(`### \`${m}\` — ${eps.length} endpoints (${eps.filter((e) => e.verbo !== 'GET').length} mutantes)`);
    p();
    p('| Verbo | Ruta | Controlador | Método |');
    p('|---|---|---|---|');
    for (const e of eps.sort((a, b) => a.ruta.localeCompare(b.ruta))) {
      p(`| ${e.verbo} | \`${e.ruta}\` | ${e.controlador} | \`${e.metodo}\` |`);
    }
  }

  // ── F. Jobs ──
  p();
  p('## F. Jobs, crons y disparadores');
  p();
  const js = jobs.filter((j) => enBloque.includes(j.modulo));
  if (!js.length) p('_Ninguno._');
  else {
    p('| Módulo | Tipo | Nombre | Archivo |');
    p('|---|---|---|---|');
    for (const j of js.sort((a, b) => a.modulo.localeCompare(b.modulo) || a.nombre.localeCompare(b.nombre))) {
      p(`| ${j.modulo} | ${j.tipo} | \`${j.nombre}\` | \`${j.fichero}\` |`);
    }
  }
  p();
  p('### Disparadores en la base');
  p();
  if (!disparadores.length) p('_Ninguno._');
  for (const d of disparadores.sort((a, b) => a.tabla.localeCompare(b.tabla))) {
    p(`- \`${d.tabla}\` → \`${d.nombre}\` (${d.evento}) — ${d.funcion}`);
  }

  const texto = L.join('\n') + '\n';
  if (salida) {
    fs.mkdirSync(path.dirname(salida), { recursive: true });
    fs.writeFileSync(salida, texto);
    console.error(`Escrito ${salida} (${texto.length} bytes, ${L.length} líneas).`);
  } else {
    console.log(texto);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
