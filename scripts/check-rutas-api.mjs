#!/usr/bin/env node
/**
 * Contrasta las rutas que el FRONTEND llama contra las que el BACKEND expone.
 *
 * Por qué existe: el 2026-07-30 se descubrió que guardar en Detalle del Cliente fallaba
 * SIEMPRE. El frontend hacía `PUT /clientes/:id` y el backend expone `@Patch(':id')`.
 * Nest respondía 404 "Cannot PUT ..." y la funcionalidad estaba muerta sin que ningún
 * test, tipo ni build lo notara: TypeScript comprueba los tipos del cuerpo, no que la
 * ruta exista. El error solo aparecía cuando un humano pulsaba Guardar.
 *
 * Es un desajuste de CONTRATO, y un contrato que nadie verifica no es un contrato.
 * Este script lo verifica de forma estática, sin levantar la app ni tocar la BD.
 *
 * Uso:  node scripts/check-rutas-api.mjs
 * Sale con código 1 si encuentra una llamada del frontend sin ruta equivalente.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND  = join(RAIZ, 'backend/src/modules');
const FRONTEND = join(RAIZ, 'frontend/src/lib/api');

const VERBOS = ['get', 'post', 'put', 'patch', 'delete'];

/**
 * Deuda CONOCIDA al introducir el verificador (2026-07-30). Son llamadas del frontend
 * cuya ruta no existe en el backend: features rotas o restos de una API que se movió.
 * Se listan para que el script falle solo ante regresiones NUEVAS — si naciera fallando
 * por deuda previa, se ignoraría desde el primer día y no serviría de nada.
 *
 * Cada línea que se corrija (creando el endpoint o borrando el código muerto) se quita
 * de aquí. La lista solo puede encoger.
 */
const DEUDA_CONOCIDA = new Set([
  // Monitoreo: el frontend habla de "nodos" y el backend expone "dispositivos". La API
  // se renombró de un lado y no del otro; `nodosApi` quedó entero apuntando al vacío.
  'GET /monitoreo/nodos',
  'GET /monitoreo/nodos/:p',
  'POST /monitoreo/nodos',
  'PUT /monitoreo/nodos/:p',
  'DELETE /monitoreo/nodos/:p',
  'POST /monitoreo/nodos/:p/ping',
  'POST /monitoreo/nodos/:p/test-conexion',
  'GET /monitoreo/nodos/:p/snmp/test',
  'POST /monitoreo/ping',
  'POST /monitoreo/scan',
  'POST /monitoreo/test-conexion',
  'GET /monitoreo/dashboard',
  'GET /monitoreo/ws/stats',
  'GET /monitoreo/alertas/configuracion',
  'POST /monitoreo/alertas/configuracion',
  'DELETE /monitoreo/alertas/configuracion/:p',
  'GET /monitoreo/alertas/historial',

  // Auth: el frontend llama endpoints de gestión de usuarios bajo /auth que viven en
  // /usuarios, o que no existen.
  'GET /auth/usuarios',
  'GET /auth/roles',
  'POST /auth/registro',
  'PATCH /auth/usuarios/:p/estado',

  // Varios
  'GET /reportes/:p/exportar',
  'GET /contratos/stats',
  'POST /contratos/:p/prorroga',
  'PATCH /proyectos-inversion/:p',
  'GET /smartolt/onus/sin-contrato',
  'GET /smartolt/onus/:p/estado-real',
]);

function archivos(dir, sufijo) {
  const out = [];
  const walk = (d) => {
    for (const nombre of readdirSync(d)) {
      const p = join(d, nombre);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(sufijo)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

// Normaliza para comparar: los nombres de los parámetros no importan, su posición sí.
// `/clientes/${id}` y `/clientes/:clienteId` describen la misma ruta.
function normalizar(ruta) {
  return ruta
    .split('?')[0]                    // la query no forma parte de la ruta
    .replace(/\$\{[^}]*\}/g, ':p')    // interpolación del frontend
    .replace(/:[A-Za-z0-9_]+/g, ':p') // parámetros de Nest
    .replace(/\/+$/, '')
    .replace(/^\/?/, '/');
}

// ── Backend: @Controller('x') + @Get('y') → "GET /x/y" ───────────────────────
function rutasBackend() {
  const rutas = new Set();

  for (const archivo of archivos(BACKEND, '.controller.ts')) {
    const src = readFileSync(archivo, 'utf8');

    // Un archivo puede declarar VARIOS @Controller (usuarios.controller.ts declara
    // usuarios, roles, permisos y personal/logs). Quedarse con el primero atribuía las
    // rutas de los demás a un prefijo equivocado y las daba por inexistentes.
    const controladores = [...src.matchAll(/@Controller\(\s*['"`]([^'"`]*)['"`]/g)];
    const bloques = controladores.length
      ? controladores.map((c, i) => ({
          base:  c[1],
          desde: c.index ?? 0,
          hasta: controladores[i + 1]?.index ?? src.length,
        }))
      : [{ base: '', desde: 0, hasta: src.length }];

    for (const { base, desde, hasta } of bloques) {
      const trozo = src.slice(desde, hasta);
      const re = /@(Get|Post|Put|Patch|Delete)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/g;
      let m;
      while ((m = re.exec(trozo)) !== null) {
        const verbo = m[1].toUpperCase();
        const sub   = m[2] ?? '';
        const ruta  = normalizar(`/${base}/${sub}`.replace(/\/{2,}/g, '/'));
        rutas.add(`${verbo} ${ruta}`);
      }
    }
  }
  return rutas;
}

// ── Frontend: api.put(`/clientes/${id}`) → "PUT /clientes/:p" ────────────────
function llamadasFrontend() {
  const llamadas = [];

  for (const archivo of archivos(FRONTEND, '.ts')) {
    const src = readFileSync(archivo, 'utf8');
    const lineas = src.split('\n');

    lineas.forEach((linea, i) => {
      for (const verbo of VERBOS) {
        // api.put<Tipo>(`/ruta`)  |  api.put('/ruta')  |  api.put<A<B>>(`/ruta`)
        //
        // `[^(]*` y no `<[^>]*>`: el genérico casi siempre viene ANIDADO
        // (`<ApiRespuesta<Cliente>>`) y un `[^>]*` corta en el primer `>`, deja el
        // segundo sin consumir y la llamada no casa. Con esa versión el verificador
        // se saltaba en silencio justo el tipo de línea que debía revisar — incluida
        // la que motivó todo esto.
        const re = new RegExp(`\\bapi\\.${verbo}\\s*[^(]*\\(\\s*['"\`]([^'"\`]+)['"\`]`, 'g');
        let m;
        while ((m = re.exec(linea)) !== null) {
          const ruta = m[1];
          // Rutas construidas por variable: no se pueden verificar estáticamente.
          if (!ruta.startsWith('/')) continue;
          llamadas.push({
            verbo:   verbo.toUpperCase(),
            ruta:    normalizar(ruta),
            archivo: relative(RAIZ, archivo).replace(/\\/g, '/'),
            linea:   i + 1,
          });
        }
      }
    });
  }
  return llamadas;
}

const backend = rutasBackend();
const frontend = llamadasFrontend();

const sinRuta = frontend.filter((l) => !backend.has(`${l.verbo} ${l.ruta}`));
const conocidas = sinRuta.filter((l) => DEUDA_CONOCIDA.has(`${l.verbo} ${l.ruta}`));
const faltantes = sinRuta.filter((l) => !DEUDA_CONOCIDA.has(`${l.verbo} ${l.ruta}`));

console.log(`Rutas del backend: ${backend.size}`);
console.log(`Llamadas del frontend verificables: ${frontend.length}`);
if (conocidas.length) {
  console.log(`Deuda conocida (no bloquea): ${conocidas.length}`);
  for (const c of conocidas) console.log(`  · ${c.verbo} ${c.ruta}  —  ${c.archivo}:${c.linea}`);
}

// Una entrada de la lista que ya no aparece es deuda saldada: hay que quitarla, o la
// lista se convierte en un cementerio que tapa la siguiente regresión.
const obsoletas = [...DEUDA_CONOCIDA].filter(
  (d) => !sinRuta.some((l) => `${l.verbo} ${l.ruta}` === d),
);
if (obsoletas.length) {
  console.log(`\n⚠ ${obsoletas.length} entrada(s) de DEUDA_CONOCIDA ya no aplican — quítalas:`);
  for (const o of obsoletas) console.log(`  · ${o}`);
}

if (faltantes.length === 0) {
  console.log('\n✓ Sin regresiones: toda llamada nueva del frontend tiene ruta en el backend.');
  process.exit(0);
}

console.log(`\n✗ ${faltantes.length} llamada(s) NUEVA(S) sin ruta equivalente:\n`);
for (const f of faltantes) {
  // Si el mismo path existe con otro verbo, decirlo: es el error más frecuente y el que
  // motivó este script.
  const otros = VERBOS
    .map((v) => v.toUpperCase())
    .filter((v) => v !== f.verbo && backend.has(`${v} ${f.ruta}`));

  console.log(`  ${f.verbo} ${f.ruta}`);
  console.log(`    ${f.archivo}:${f.linea}`);
  if (otros.length) console.log(`    → el backend la expone como: ${otros.join(', ')}`);
  else console.log('    → esa ruta no existe en ningún verbo');
  console.log();
}
process.exit(1);
