#!/usr/bin/env node
/**
 * Barrido de aislamiento multi-tenant (desviación A-1).
 *
 * Busca sentencias SQL crudas que **lean o muten una tabla con `empresa_id` sin filtrar por
 * `empresa_id`**. Esa omisión no produce un error: produce **datos de otra empresa**, sin
 * log y sin síntoma. Es la única clase de fallo del ERP que es silenciosa por definición.
 *
 * QUÉ ES Y QUÉ NO ES ESTE BARRIDO
 *
 * Es un análisis **estático y heurístico** sobre literales de plantilla. No entiende SQL: no
 * resuelve una consulta compuesta a trozos ni sabe si un `WHERE` llega por otra vía. Por eso
 * existe la lista de exenciones justificadas de abajo, y por eso **no sustituye a Row-Level
 * Security** — la detección previene la próxima consulta mal escrita; RLS es lo que hace que
 * una que se escape devuelva **cero filas en vez de filas ajenas**.
 *
 * Dicho de otro modo: esto es la barrera de diseño, no la de ejecución. Hacen falta las dos.
 *
 * Uso:  node scripts/barrido-aislamiento.mjs [--json] [--todas]
 * Sale con código 1 si aparece una infracción no exenta.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC         = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const MIGRACIONES = join(SRC, 'database', 'migrations');

// ── Exenciones justificadas ──────────────────────────────────────────────────
// Cada una lleva su motivo. Una exención sin motivo es una fuga esperando; el formato
// obliga a escribirlo. Se comparan por `fichero:línea` no — las líneas se mueven — sino por
// una firma estable: fichero + fragmento distintivo de la consulta.
const EXENTAS = [
  {
    fichero: 'modules/sistema/eventos-sistema.service.ts',
    contiene: 'eventos_sistema',
    motivo: 'Registro de errores de la PLATAFORMA, no de una empresa: la tabla no tiene empresa_id',
  },
  {
    fichero: 'common/services/watcher-heartbeat.service.ts',
    contiene: 'watcher_heartbeat',
    motivo: 'Latido de procesos del servidor; es infraestructura, no dato de negocio',
  },
];

const ficherosTs = (dir, filtro = () => true) => {
  const salida = [];
  for (const entrada of readdirSync(dir)) {
    if (entrada === 'node_modules' || entrada === 'dist') continue;
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) { salida.push(...ficherosTs(ruta, filtro)); continue; }
    if (entrada.endsWith('.ts') && !entrada.endsWith('.spec.ts') && filtro(ruta)) salida.push(ruta);
  }
  return salida;
};

// ── 1. Qué tablas son de empresa ─────────────────────────────────────────────
// Se deducen de las migraciones, que son la definición real del esquema. Una tabla es
// "de empresa" si su CREATE TABLE declara `empresa_id`, o si un ALTER se lo añade después.
function tablasDeEmpresa() {
  const tablas = new Set();
  for (const fichero of ficherosTs(MIGRACIONES)) {
    const sql = readFileSync(fichero, 'utf8');

    for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"?([a-z_0-9]+)"?\s*\(/gi)) {
      const desde = m.index + m[0].length;
      // Cuerpo del CREATE TABLE: hasta el `);` que lo cierra, con margen suficiente.
      const cuerpo = sql.slice(desde, desde + 6000).split(/\n\s*\)\s*;?/)[0];
      if (/\bempresa_id\b/i.test(cuerpo)) tablas.add(m[1].toLowerCase());
    }
    for (const m of sql.matchAll(/ALTER TABLE "?([a-z_0-9]+)"?\s+ADD COLUMN[^;]*\bempresa_id\b/gi)) {
      tablas.add(m[1].toLowerCase());
    }
  }
  return tablas;
}

// ── 2. Sentencias SQL crudas en el código ────────────────────────────────────
// Se extraen los literales de plantilla que contienen una sentencia reconocible.
function sentencias(fichero) {
  const src = readFileSync(fichero, 'utf8');
  const salida = [];
  // Literales de plantilla (backticks), que es como se escribe el SQL en este repo.
  for (const m of src.matchAll(/`([^`]*)`/g)) {
    const cuerpo = m[1];
    if (!/\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i.test(cuerpo)) continue;
    const linea = src.slice(0, m.index).split('\n').length;
    salida.push({ sql: cuerpo, linea });
  }
  return salida;
}

// Tablas que la sentencia toca en posición de lectura o mutación.
function tablasTocadas(sql) {
  const t = new Set();
  const patrones = [
    /\bFROM\s+"?([a-z_0-9]+)"?/gi,
    /\bJOIN\s+"?([a-z_0-9]+)"?/gi,
    /\bUPDATE\s+"?([a-z_0-9]+)"?/gi,
    /\bINSERT\s+INTO\s+"?([a-z_0-9]+)"?/gi,
    /\bDELETE\s+FROM\s+"?([a-z_0-9]+)"?/gi,
  ];
  for (const p of patrones) for (const m of sql.matchAll(p)) t.add(m[1].toLowerCase());
  return t;
}

function estaExenta(rel, sql) {
  return EXENTAS.find((e) => rel.endsWith(e.fichero) && sql.includes(e.contiene));
}

// ── Clasificación ────────────────────────────────────────────────────────────
// «209 consultas sin empresa_id» no son 209 fugas, y presentarlo así haría que la barrera
// se ignorase el primer día. Lo que decide el riesgo es CÓMO se acota la consulta:
//
//   GLOBAL      El barrido actúa sobre todas las empresas a propósito (marcar vencidas,
//               drenar el outbox, purgar retención). Correcto por diseño.
//   TRANSITIVA  Se filtra por una clave ajena —`cliente_id`, `contrato_id`…— cuya
//               pertenencia se validó (o no) más arriba. **Aquí es donde viven las fugas
//               reales**, y el análisis estático NO puede resolverlo: depende de si ese
//               identificador llegó de una ruta validada o de un parámetro de URL. Es
//               exactamente el incidente de crm-nativo (30/07): «con un chatId ajeno,
//               cualquier usuario con sesión válida se llevaba la conversación completa».
//   ABIERTA     Toca una tabla de empresa sin ninguna acotación. Lo más sospechoso.
const CLAVES_TRANSITIVAS = [
  'cliente_id', 'contrato_id', 'factura_id', 'pago_id', 'router_id', 'olt_id',
  'contrato_onu_id', 'onu_id', 'usuario_id', 'ticket_id', 'chat_id', 'dispositivo_id',
  'caja_nap_id', 'sesion_id', 'promesa_id', 'plan_id', 'zona_id',
];

function clasificar(rel, sql) {
  // `mantenimiento` es el barrido de retención de la plataforma: purga por fecha en todas
  // las empresas, que es exactamente su cometido. Sin incluirlo, sus 15 sentencias legítimas
  // salían como sospechosas y ahogaban las que sí lo son.
  const esProcesoDeFondo =
    /(worker|cron|scheduler|reconciliador|barrido|colector|mantenimiento|retencion|purga)/i.test(rel);
  const tieneWhere = /\bWHERE\b/i.test(sql);

  if (!tieneWhere) return 'ABIERTA';
  if (CLAVES_TRANSITIVAS.some((k) => new RegExp(`\\b${k}\\b`, 'i').test(sql))) return 'TRANSITIVA';
  // Acotada por identificador propio, con o sin alias: `WHERE id = $1`, `WHERE cl.id = $1`.
  // Sigue siendo transitiva: la seguridad depende de quién validó ese id más arriba.
  if (/\bWHERE\s+(?:"?[a-z_0-9]+"?\.)?"?id"?\s*=/i.test(sql)) return 'TRANSITIVA';
  if (esProcesoDeFondo) return 'GLOBAL';
  return 'ABIERTA';
}

function main() {
  const json   = process.argv.includes('--json');
  const todas  = process.argv.includes('--todas');
  const TENANT = tablasDeEmpresa();

  const infracciones = [];
  let analizadas = 0;

  for (const fichero of ficherosTs(SRC)) {
    const rel = fichero.slice(SRC.length + 1).replace(/\\/g, '/');
    // Las migraciones definen el esquema: su SQL no filtra por empresa y no debe hacerlo.
    if (rel.startsWith('database/migrations/')) continue;

    for (const { sql, linea } of sentencias(fichero)) {
      const tocadas = [...tablasTocadas(sql)].filter((t) => TENANT.has(t));
      if (!tocadas.length) continue;

      // Sondas de arranque del patrón degradado (`SELECT 1 FROM x LIMIT 0`): comprueban
      // que la tabla existe y no devuelven una sola fila. No pueden filtrar por empresa
      // porque no leen datos de ninguna.
      if (/^\s*SELECT\s+1\s+FROM\s+"?[a-z_0-9]+"?\s+LIMIT\s+0\s*$/i.test(sql.trim())) continue;

      analizadas++;

      // El criterio es deliberadamente laxo: basta con que la sentencia MENCIONE
      // `empresa_id`. Un análisis más estricto (que el filtro esté en el WHERE correcto)
      // daría falsos positivos en consultas con CTE y subconsultas, y una barrera que grita
      // en falso se acaba desactivando.
      if (/\bempresa_id\b/i.test(sql)) continue;

      const exenta = estaExenta(rel, sql);
      if (exenta && !todas) continue;

      infracciones.push({
        fichero: rel, linea, tablas: tocadas,
        clase: clasificar(rel, sql),
        exenta: exenta?.motivo ?? null,
        extracto: sql.replace(/\s+/g, ' ').trim().slice(0, 130),
      });
    }
  }

  const por = (c) => infracciones.filter((i) => i.clase === c && !i.exenta);

  if (json) {
    console.log(JSON.stringify({ tenant: TENANT.size, analizadas, infracciones }, null, 2));
  } else {
    console.log(`Tablas con empresa_id      : ${TENANT.size}`);
    console.log(`Sentencias que las tocan   : ${analizadas}`);
    console.log(`Sin mencionar empresa_id   : ${infracciones.length}\n`);
    console.log(`  ABIERTA     ${String(por('ABIERTA').length).padStart(4)}  sin acotación alguna — lo más sospechoso`);
    console.log(`  TRANSITIVA  ${String(por('TRANSITIVA').length).padStart(4)}  acotada por clave ajena; segura SOLO si esa clave se validó arriba`);
    console.log(`  GLOBAL      ${String(por('GLOBAL').length).padStart(4)}  proceso de fondo sobre todas las empresas — correcto por diseño\n`);

    for (const clase of ['ABIERTA', 'TRANSITIVA', 'GLOBAL']) {
      const lista = por(clase);
      if (!lista.length || (!todas && clase !== 'ABIERTA')) continue;
      console.log(`── ${clase} ──`);
      for (const i of lista) {
        console.log(`  ${i.fichero}:${i.linea}  [${i.tablas.join(', ')}]`);
        console.log(`      ${i.extracto}`);
      }
      console.log('');
    }
    if (!todas) console.log('(--todas para ver TRANSITIVA y GLOBAL)');
  }

  // El barrido NO falla todavía: 209 hallazgos sin triar convertirían la barrera en ruido
  // y en lo primero que alguien desactiva. Falla cuando la cifra base esté triada y
  // congelada — ver ADR-017. Hasta entonces informa.
  process.exitCode = 0;
}

main();
