import * as fs from 'fs';
import * as path from 'path';
import { analizarCodigo, clasificarRetorno, sinComentarios, type MetodoInfo } from './metodos-frontera';

/**
 * E-0.2 — Auditoría de INTERACCIONES: la fotografía de cómo se hablan hoy los módulos.
 *
 * No es otro inventario. El inventario (`inventario-bloque.ts`) responde «qué hay»; esto
 * responde «quién llama a quién, con qué operación, qué devuelve, qué escribe y qué anuncia».
 *
 * Un mapa de `import`s no sirve para esto: un import puede ser un tipo o un enum. Lo que sí es
 * una llamada real en ejecución es `this.<servicioInyectado>.<método>(...)`, y eso es lo que se
 * mide aquí — atribuido al método que la provoca, que es la pregunta del bloque 1.
 *
 *     npm run interacciones
 *     npm run interacciones -- --out docs/gobierno/inventario/E-0.2-interacciones.md
 *
 * LÍMITES DECLARADOS — esto es un suelo, no un total:
 *   · La extensión de un método se delimita por la siguiente declaración de método de la misma
 *     clase (indentación 2). Un método declarado con otra indentación no se ve.
 *   · Se detectan llamadas por servicio inyectado en el constructor. Un `moduleRef.get()` o una
 *     llamada dinámica no se ven.
 *   · Los eventos se detectan por `.emit('nombre')` y `@OnEvent('nombre')` literales. Un nombre
 *     construido en ejecución no se ve.
 */

// ── Flujos a desplegar en el bloque 6 ───────────────────────────────────────
// Verificados contra el código antes de escribirlos: si alguno desaparece, el informe lo dice
// en vez de callarlo.
const FLUJOS: Array<{ grupo: string; nombre: string; entrada: string }> = [
  { grupo: 'Comercial', nombre: 'Alta de cliente',           entrada: 'ClientesService.create' },
  { grupo: 'Comercial', nombre: 'Alta cliente + servicio (onboarding)', entrada: 'ClientesService.onboarding' },
  { grupo: 'Comercial', nombre: 'Alta de servicio',          entrada: 'ContratosService.create' },
  { grupo: 'Comercial', nombre: 'Activación',                entrada: 'ContratosService.activar' },
  { grupo: 'Comercial', nombre: 'Cambio de estado (suspensión / corte)', entrada: 'ContratosService.cambiarEstado' },
  { grupo: 'Comercial', nombre: 'Reactivación por pago',     entrada: 'ContratosService.reactivarPorPago' },
  { grupo: 'Comercial', nombre: 'Baja de servicio',          entrada: 'ContratosService.remove' },
  { grupo: 'Técnico',   nombre: 'Provisionamiento FTTH',     entrada: 'ProvisionFtthService.provisionarFtth' },
  { grupo: 'Técnico',   nombre: 'Actualización WAN de la ONU', entrada: 'ProvisionFtthService.actualizarWan' },
  { grupo: 'Técnico',   nombre: 'Desaprovisionar FTTH',      entrada: 'ProvisionFtthService.desaprovisionarPorContrato' },
  { grupo: 'Técnico',   nombre: 'Desaprovisionar MikroTik',  entrada: 'ContratosService.desaprovisionarMikrotik' },
  { grupo: 'Técnico',   nombre: 'Reconciliación FTTH',       entrada: 'ProvisionFtthService.reconciliar' },
  { grupo: 'Dinero',    nombre: 'Emisión mensual',           entrada: 'FacturacionService.generarMensual' },
  { grupo: 'Dinero',    nombre: 'Registro de pago',          entrada: 'PagosService.registrar' },
  { grupo: 'Dinero',    nombre: 'Aplicación de pago a factura', entrada: 'FacturacionService.aplicarPago' },
];

// Fronteras que interesan en el bloque 2. El Core es lo que no puede caerse.
const CORE = ['clientes', 'contratos', 'planes', 'facturacion', 'pagos', 'usuarios', 'auth', 'config'];
const FAMILIA: Record<string, string> = {
  mikrotik: 'Network', vpn: 'Network', monitoreo: 'Network',
  'olt-nativo': 'OLT', smartolt: 'OLT', aprovisionamiento: 'OLT',
  'planta-externa': 'Planta',
  facturacion: 'Facturación', pagos: 'Pagos', 'promesas-pago': 'Pagos', 'finanzas-opex': 'Pagos',
  mensajeria: 'Mensajería', notificaciones: 'Mensajería', webhooks: 'Mensajería',
  xui: 'IPTV',
  'outbox-red': 'Transversal', workers: 'Transversal', sagas: 'Transversal',
  auditoria: 'Transversal', sistema: 'Transversal', reconciliador: 'Transversal',
};
const familiaDe = (m: string) => (CORE.includes(m) ? 'Core' : FAMILIA[m] ?? 'Otro');

// ── Recorrido ───────────────────────────────────────────────────────────────
// Detección de métodos, endpoints y consumidores de eventos: en `metodos-frontera.ts`,
// compartida con la barrera de E03-03 (Ola 1) — un solo instrumento midiendo lo mismo, mismo
// criterio que unificó la detección de escritores en la Ola 0 (`escritores-tabla.ts`).
const SRC_DIR = path.resolve('src');
const { metodos, endpoints, consumidores } = analizarCodigo(SRC_DIR);
const ficheros: string[] = [];
(function recorrer(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'migrations') recorrer(p); }
    else if (e.name.endsWith('.ts') && !e.name.includes('.spec.')) ficheros.push(p);
  }
})('src');

const moduloDe = (f: string): string =>
  (/src[\\/]modules[\\/]([^\\/]+)[\\/]/.exec(f) || [, 'common'])[1] as string;
const relativo = (f: string) => path.relative('src', f).split(path.sep).join('/');

// `Metodo`, `metodos`, `endpoints` y `consumidores` los produce `analizarCodigo()` (arriba).
type Metodo = MetodoInfo;

// clase → módulo/fichero, por declaración `export class X`, sea o no la clase tiene métodos
// que la barrera de indentación detecte. **Existen dos clases llamadas `AuditoriaService`**
// (`modules/auditoria/auditoria.service.ts` y `modules/auth/auditoria.service.ts`) — una
// ambigüedad real del código, no de este script. Con una sola clave por nombre, «gana la
// última declaración en orden de recorrido», que es el criterio que este informe siempre usó;
// se mantiene aquí explícito en vez de dejarlo como efecto colateral del orden de `metodos`.
const moduloDeClase: Record<string, string> = {};
const ficheroDeClase: Record<string, string> = {};
for (const f of ficheros) {
  const s = sinComentarios(fs.readFileSync(f, 'utf8'));
  for (const [, clase] of s.matchAll(/export class (\w+)/g)) {
    moduloDeClase[clase] = moduloDe(f);
    ficheroDeClase[clase] = relativo(f);
  }
}

const buscar = (clase: string, metodo: string) => metodos.find((m) => m.clase === clase && m.nombre === metodo);

// ── Informe ─────────────────────────────────────────────────────────────────
const L: string[] = [];
const p = (s = '') => L.push(s);
const flecha = (a: string, b: string) => `${a} → ${b}`;

p('# E-0.2 — Auditoría de interacciones');
p();
p(`Generado por \`auditoria-interacciones.ts\` el ${new Date().toISOString().slice(0, 10)}.`);
p('Es la fotografía de cómo funciona Datafast **hoy**, no una propuesta de diseño.');
p('No se edita a mano: se vuelve a correr con `npm run interacciones`.');
p();
p('> **Límites declarados.** Se miden llamadas por servicio inyectado en el constructor');
p('> (`this.x.y()`), escrituras en SQL crudo y por repositorio TypeORM, y eventos con nombre');
p('> literal. Un `moduleRef.get()`, una llamada dinámica o un nombre de evento construido en');
p('> ejecución no se ven. Las cifras son un **suelo**.');

// ══ BLOQUE 1 ══
p();
p('## Bloque 1 — Mapa real de llamadas entre módulos');
p();
p('Qué operación provoca cada llamada. No son imports: es `this.<servicioInyectado>.<método>()`.');

const aristas = new Map<string, Map<string, Set<string>>>();
for (const m of metodos) {
  for (const c of m.llamadas) {
    const dest = moduloDeClase[c.clase];
    if (!dest || dest === m.modulo) continue;
    const porDestino = aristas.get(m.modulo) ?? new Map();
    aristas.set(m.modulo, porDestino);
    const ops = porDestino.get(dest) ?? new Set<string>();
    porDestino.set(dest, ops);
    ops.add(`${m.clase}.${m.nombre}() → ${c.clase}.${c.metodo}()`);
  }
}

for (const desde of [...aristas.keys()].sort()) {
  const porDestino = aristas.get(desde)!;
  p();
  p(`### \`${desde}\` (${familiaDe(desde)})`);
  for (const hacia of [...porDestino.keys()].sort()) {
    const ops = [...porDestino.get(hacia)!].sort();
    p();
    p(`**${flecha(desde, hacia)}** _(${familiaDe(desde)} → ${familiaDe(hacia)})_ — ${ops.length} llamadas`);
    p();
    for (const o of ops) p(`- ${o}`);
  }
}

p();
p('### Resumen por familia');
p();
const familias = new Map<string, Set<string>>();
for (const [d, m] of aristas) for (const h of m.keys()) {
  const k = flecha(familiaDe(d), familiaDe(h));
  (familias.get(k) ?? familias.set(k, new Set()).get(k)!).add(flecha(d, h));
}
p('| Frontera | Pares de módulos |');
p('|---|---|');
for (const [k, v] of [...familias.entries()].sort((a, b) => b[1].size - a[1].size)) {
  p(`| ${k} | ${v.size} — ${[...v].sort().join(', ')} |`);
}

// ══ BLOQUE 2 ══
p();
p('## Bloque 2 — Operaciones públicas de cada dominio');
p();
p('Métodos públicos de los servicios, agrupados por familia. Es la frontera que otro módulo');
p('puede invocar hoy, exista o no la intención de que sea pública.');

const porFamilia = new Map<string, Map<string, Metodo[]>>();
for (const m of metodos) {
  if (m.visibilidad !== 'public' || !/Service$/.test(m.clase)) continue;
  if (/^(onModuleInit|onModuleDestroy|onApplicationBootstrap|beforeApplicationShutdown)$/.test(m.nombre)) continue;
  const fam = familiaDe(m.modulo);
  const porClase = porFamilia.get(fam) ?? porFamilia.set(fam, new Map()).get(fam)!;
  (porClase.get(m.clase) ?? porClase.set(m.clase, []).get(m.clase)!).push(m);
}
for (const fam of [...porFamilia.keys()].sort()) {
  p();
  p(`### ${fam}`);
  const porClase = porFamilia.get(fam)!;
  for (const clase of [...porClase.keys()].sort()) {
    const ms = porClase.get(clase)!;
    // Un método invocado desde otro módulo es frontera de hecho, no solo de derecho.
    const invocadoDesde = (n: string) => [...new Set(metodos
      .filter((x) => x.modulo !== ms[0].modulo && x.llamadas.some((c) => c.clase === clase && c.metodo === n))
      .map((x) => x.modulo))].sort();
    p();
    p(`#### \`${clase}\` — ${ms.length} públicos · \`${ficheroDeClase[clase]}\``);
    p();
    p('| Operación | Devuelve | Invocado desde |');
    p('|---|---|---|');
    for (const m of ms.sort((a, b) => a.nombre.localeCompare(b.nombre))) {
      const q = invocadoDesde(m.nombre);
      p(`| \`${m.nombre}()\` | ${clasificarRetorno(m.retorno)} | ${q.join(', ') || '—'} |`);
    }
  }
}

// ══ BLOQUE 3 ══
p();
p('## Bloque 3 — Qué devuelve cada operación');
p();
const publicos = metodos.filter((m) => m.visibilidad === 'public' && /Service$/.test(m.clase));
const conteo = new Map<string, number>();
for (const m of publicos) conteo.set(clasificarRetorno(m.retorno), (conteo.get(clasificarRetorno(m.retorno)) ?? 0) + 1);
p('| Clase de retorno | Operaciones | Qué significa hoy |');
p('|---|---:|---|');
const SIGNIFICADO: Record<string, string> = {
  'ResultadoOperacion': 'Vocabulario de dominio: aplicado · ya_en_destino · no_aplica · rechazado_definitivo · reintentable · indeterminado. Un orquestador puede decidir sin interpretar.',
  'void': 'No informa nada. El fallo solo puede llegar por excepción; el éxito no se distingue del no-op.',
  'boolean': 'Éxito/fallo sin causa. Un false no dice si reintentar.',
  'objeto': 'El recurso resultante. El estado hay que deducirlo de sus campos.',
  'objeto o null': 'El recurso o su ausencia. La ausencia no dice por qué.',
  'objeto anónimo': 'Forma declarada en la firma, sin tipo con nombre — no reutilizable ni verificable.',
  'colección': 'Lectura de varios.',
  'string (id o texto)': 'Identificador o mensaje.',
  'number': 'Cuenta o importe.',
  'sin tipar (any)': 'No hay contrato. El compilador no protege a quien llama.',
  'sin anotar (inferido)': 'Sin anotación explícita: el contrato es lo que hoy devuelva el cuerpo.',
};
for (const [k, v] of [...conteo.entries()].sort((a, b) => b[1] - a[1])) {
  p(`| ${k} | ${v} | ${SIGNIFICADO[k] ?? ''} |`);
}
p();
p(`**${publicos.length} operaciones públicas.** ` +
  `Solo **${conteo.get('ResultadoOperacion') ?? 0}** hablan el vocabulario de dominio; ` +
  `**${(conteo.get('void') ?? 0) + (conteo.get('boolean') ?? 0)}** devuelven \`void\` o \`boolean\`, ` +
  `y **${(conteo.get('sin tipar (any)') ?? 0) + (conteo.get('sin anotar (inferido)') ?? 0)}** no declaran contrato.`);

p();
p('### Quién habla ya el vocabulario de dominio');
p();
for (const m of publicos.filter((x) => clasificarRetorno(x.retorno) === 'ResultadoOperacion')
                        .sort((a, b) => a.clase.localeCompare(b.clase) || a.nombre.localeCompare(b.nombre))) {
  p(`- \`${m.clase}.${m.nombre}()\` — ${m.modulo}`);
}

p();
p('### Operaciones de frontera que NO lo hablan');
p();
p('Invocadas desde otro módulo y sin `ResultadoOperacion`: quien las llama tiene que interpretar.');
p();
p('| Operación | Módulo | Devuelve | La llaman |');
p('|---|---|---|---|');
for (const m of publicos) {
  const cls = clasificarRetorno(m.retorno);
  if (cls === 'ResultadoOperacion') continue;
  const desde = [...new Set(metodos
    .filter((x) => x.modulo !== m.modulo && x.llamadas.some((c) => c.clase === m.clase && c.metodo === m.nombre))
    .map((x) => x.modulo))].sort();
  if (!desde.length) continue;
  p(`| \`${m.clase}.${m.nombre}()\` | ${m.modulo} | ${cls} | ${desde.join(', ')} |`);
}

// ══ BLOQUE 4 ══
p();
p('## Bloque 4 — Eventos reales');
p();
const emisores = metodos.flatMap((m) => m.emite.map((e) => ({ evento: e, m })));
const nombres = [...new Set([...emisores.map((x) => x.evento), ...consumidores.map((c) => c.evento)])].sort();
if (!nombres.length) {
  p('**No hay eventos.** Todo es llamada directa.');
} else {
  p(`${nombres.length} nombres de evento distintos · ${emisores.length} emisiones · ${consumidores.length} escuchas.`);
  p();
  p('| Evento | Lo produce | Lo consume |');
  p('|---|---|---|');
  for (const n of nombres) {
    const prod = [...new Set(emisores.filter((x) => x.evento === n).map((x) => `${x.m.clase}.${x.m.nombre}()`))].sort();
    const cons = [...new Set(consumidores.filter((c) => c.evento === n).map((c) => `${c.clase}.${c.metodo}() [${c.modulo}]`))].sort();
    p(`| \`${n}\` | ${prod.join('<br>') || '**nadie**'} | ${cons.join('<br>') || '**nadie**'} |`);
  }
  const huerfanos = nombres.filter((n) => !consumidores.some((c) => c.evento === n));
  const fantasmas = nombres.filter((n) => !emisores.some((e) => e.evento === n));
  p();
  if (huerfanos.length) {
    p(`**${huerfanos.length} eventos que nadie escucha** — se emiten al vacío: ` +
      huerfanos.map((n) => `\`${n}\``).join(', ') + '.');
  }
  if (fantasmas.length) {
    p();
    p(`**${fantasmas.length} escuchas sin emisor detectado** — o el nombre se construye en ejecución, ` +
      'o el evento ya no se emite: ' + fantasmas.map((n) => `\`${n}\``).join(', ') + '.');
  }
}

p();
p('### Colas (BullMQ) — el otro canal asíncrono');
p();
const encolan = metodos.flatMap((m) => m.encola.map((j) => ({ job: j.split(' @ ')[0], cola: j.split(' @ ')[1], m })));
const procesan = metodos.filter((m) => m.procesaJob);
const jobs = [...new Set([...encolan.map((x) => x.job), ...procesan.map((m) => m.procesaJob!)])].sort();
if (!jobs.length) p('_Ninguna._');
else {
  p('| Trabajo | Cola | Lo encola | Lo procesa |');
  p('|---|---|---|---|');
  for (const j of jobs) {
    const q = [...new Set(encolan.filter((x) => x.job === j).map((x) => `${x.m.clase}.${x.m.nombre}()`))].sort();
    const cola = [...new Set(encolan.filter((x) => x.job === j).map((x) => x.cola))].join(', ');
    const w = procesan.filter((m) => m.procesaJob === j).map((m) => `${m.clase}.${m.nombre}()`);
    p(`| \`${j}\` | ${cola || '—'} | ${q.join('<br>') || '**nadie**'} | ${w.join('<br>') || '**nadie**'} |`);
  }
  const sinProcesador = jobs.filter((j) => !procesan.some((m) => m.procesaJob === j));
  const sinEmisor = jobs.filter((j) => !encolan.some((x) => x.job === j));
  if (sinProcesador.length) {
    p();
    p(`**${sinProcesador.length} trabajos que se encolan y nadie procesa:** ` +
      sinProcesador.map((j) => `\`${j}\``).join(', ') + '.');
  }
  if (sinEmisor.length) {
    p();
    p(`**${sinEmisor.length} procesadores sin nadie que encole:** ` +
      sinEmisor.map((j) => `\`${j}\``).join(', ') + '.');
  }
}

// ══ BLOQUE 5 ══
p();
p('## Bloque 5 — Escrituras provocadas por una operación');
p();
p('Por cada operación de frontera: qué escribe ella misma y qué escribe lo que invoca.');
p('Es donde se ve dónde acaba una responsabilidad y dónde empieza la invasión de otra.');

const dueno: Record<string, string> = {};
for (const [, tabla, d] of fs.readFileSync('src/common/domain/propiedad-tablas.ts', 'utf8')
                             .matchAll(/^\s*(\w+):\s*\{[^}]*dueno:\s*'([^']+)'/gm)) dueno[tabla] = d;

/** Cierre transitivo de escrituras, con guarda de ciclos y profundidad acotada. */
function escriturasDe(m: Metodo, prof = 3, visto = new Set<string>()): Map<string, Set<string>> {
  const r = new Map<string, Set<string>>();
  const clave = `${m.clase}.${m.nombre}`;
  if (visto.has(clave) || prof < 0) return r;
  visto.add(clave);
  for (const w of m.escribe) (r.get(w.tabla) ?? r.set(w.tabla, new Set()).get(w.tabla)!).add(m.modulo);
  for (const c of m.llamadas) {
    const hijo = buscar(c.clase, c.metodo);
    if (!hijo) continue;
    for (const [t, mods] of escriturasDe(hijo, prof - 1, visto)) {
      const s = r.get(t) ?? r.set(t, new Set()).get(t)!;
      for (const x of mods) s.add(x);
    }
  }
  return r;
}

const frontera = publicos.filter((m) => metodos.some((x) => x.modulo !== m.modulo &&
  x.llamadas.some((c) => c.clase === m.clase && c.metodo === m.nombre)));
p();
p('| Operación | Escribe directamente | Escribe a través de lo que llama |');
p('|---|---|---|');
for (const m of frontera.sort((a, b) => a.clase.localeCompare(b.clase) || a.nombre.localeCompare(b.nombre))) {
  const directas = [...new Set(m.escribe.map((w) => w.tabla))].sort();
  const todas = [...escriturasDe(m).keys()].sort();
  const indirectas = todas.filter((t) => !directas.includes(t));
  const marcar = (t: string) => (dueno[t] && dueno[t] !== m.modulo ? `**\`${t}\`**` : `\`${t}\``);
  if (!todas.length) continue;
  p(`| \`${m.clase}.${m.nombre}()\` | ${directas.map(marcar).join(', ') || '—'} | ${indirectas.map((t) => `\`${t}\``).join(', ') || '—'} |`);
}
p();
p('En negrita, la tabla que la operación escribe **sin ser su dueño** según el manifiesto PA-12.');

// ══ BLOQUE 6 ══
p();
p('## Bloque 6 — Flujos completos');
p();
p('Cada flujo desplegado desde su punto de entrada. `W:` lo que escribe · `E:` lo que emite ·');
p('`Q:` lo que encola. Se corta a profundidad 4 y en el primer ciclo.');

function desplegar(m: Metodo, prof: number, visto: Set<string>, sangria: string, salida: string[]) {
  const clave = `${m.clase}.${m.nombre}`;
  const anota: string[] = [];
  const w = [...new Set(m.escribe.map((x) => x.tabla))];
  if (w.length) anota.push(`W: ${w.join(', ')}`);
  if (m.emite.length) anota.push(`E: ${[...new Set(m.emite)].join(', ')}`);
  if (m.encola.length) anota.push(`Q: ${[...new Set(m.encola)].join(', ')}`);
  salida.push(`${sangria}${clave}()  [${m.modulo} · ${familiaDe(m.modulo)}] → ${clasificarRetorno(m.retorno)}` +
              (anota.length ? `\n${sangria}    ${anota.join(' · ')}` : ''));
  if (visto.has(clave)) { salida.push(`${sangria}  ↺ ya desplegado`); return; }
  visto.add(clave);
  if (prof <= 0) { if (m.llamadas.length) salida.push(`${sangria}  … (${m.llamadas.length} llamadas más)`); return; }
  const hijos = [...new Map(m.llamadas.map((c) => [`${c.clase}.${c.metodo}`, c])).values()];
  for (const c of hijos) {
    const h = buscar(c.clase, c.metodo);
    if (h) desplegar(h, prof - 1, visto, sangria + '  ', salida);
  }
}

for (const grupo of [...new Set(FLUJOS.map((f) => f.grupo))]) {
  p();
  p(`### ${grupo}`);
  for (const f of FLUJOS.filter((x) => x.grupo === grupo)) {
    const [clase, nombre] = f.entrada.split('.');
    const m = buscar(clase, nombre);
    p();
    p(`#### ${f.nombre}`);
    p();
    if (!m) { p(`_\`${f.entrada}\` ya no existe en el código. El flujo declarado quedó obsoleto._`); continue; }
    const eps = endpoints.filter((e) => e.delega.includes(f.entrada));
    p(`Entrada HTTP: ${eps.map((e) => `\`${e.verbo} ${e.ruta}\``).join(', ') || '_ninguna — solo interna_'}`);
    p();
    const salida: string[] = [];
    desplegar(m, 4, new Set(), '', salida);
    p('```');
    for (const l of salida) p(l);
    p('```');
    const tablas = [...escriturasDe(m, 4).keys()].sort();
    p();
    p(`**Tablas tocadas en todo el flujo (${tablas.length}):** ${tablas.map((t) => `\`${t}\``).join(', ') || '—'}`);
  }
}

const texto = L.join('\n') + '\n';
const salida = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
if (salida) {
  fs.mkdirSync(path.dirname(salida), { recursive: true });
  fs.writeFileSync(salida, texto);
  console.error(`Escrito ${salida} (${texto.length} bytes, ${L.length} líneas).`);
} else {
  console.log(texto);
}
