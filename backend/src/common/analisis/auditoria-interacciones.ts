import * as fs from 'fs';
import * as path from 'path';

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
const ficheros: string[] = [];
(function recorrer(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'migrations') recorrer(p); }
    else if (e.name.endsWith('.ts') && !e.name.includes('.spec.')) ficheros.push(p);
  }
})('src');

const sinComentarios = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))   // conserva las líneas
   .replace(/(^|[^:])\/\/.*$/gm, '$1');

const moduloDe = (f: string): string =>
  (/src[\\/]modules[\\/]([^\\/]+)[\\/]/.exec(f) || [, 'common'])[1] as string;
const relativo = (f: string) => path.relative('src', f).split(path.sep).join('/');

// Entidad → tabla, para poder leer las escrituras por repositorio.
const tablaDeEntidad: Record<string, string> = {};
for (const f of ficheros) {
  for (const [, tabla, clase] of fs.readFileSync(f, 'utf8')
       .matchAll(/@Entity\('(\w+)'\)[\s\S]{0,300}?export class (\w+)/g)) {
    tablaDeEntidad[clase] = tabla;
  }
}

// ── Modelo ──────────────────────────────────────────────────────────────────
interface Metodo {
  clase: string; modulo: string; fichero: string; linea: number;
  nombre: string; visibilidad: 'public' | 'private' | 'protected';
  retorno: string;
  llamadas: Array<{ clase: string; metodo: string }>;
  escribe: Array<{ tabla: string; op: string }>;
  emite: string[];
  encola: string[];
  escuchaEvento?: string;
  procesaJob?: string;
}

const metodos: Metodo[] = [];
const moduloDeClase: Record<string, string> = {};
const ficheroDeClase: Record<string, string> = {};
const consumidores: Array<{ evento: string; clase: string; metodo: string; modulo: string }> = [];
const endpoints: Array<{ modulo: string; verbo: string; ruta: string; controlador: string; metodo: string; delega: string[] }> = [];

const OPS_ORM = 'save|insert|update|upsert|delete|remove|softDelete|softRemove|restore|increment|decrement';

// Paso 1: clase → módulo (hace falta antes de resolver las llamadas).
for (const f of ficheros) {
  const s = sinComentarios(fs.readFileSync(f, 'utf8'));
  for (const [, clase] of s.matchAll(/export class (\w+)/g)) {
    moduloDeClase[clase] = moduloDe(f);
    ficheroDeClase[clase] = relativo(f);
  }
}

// Paso 2: métodos, con su extensión, y todo lo que ocurre dentro.
for (const f of ficheros) {
  const s = sinComentarios(fs.readFileSync(f, 'utf8'));
  const mod = moduloDe(f);
  const rel = relativo(f);
  const lineaDe = (i: number) => s.slice(0, i).split('\n').length;

  const clases = [...s.matchAll(/export class (\w+)/g)].map((m) => ({ nombre: m[1], desde: m.index! }));
  if (!clases.length) continue;
  const claseEn = (i: number) => {
    let c = clases[0].nombre;
    for (const k of clases) if (k.desde <= i) c = k.nombre; else break;
    return c;
  };

  // Inyecciones del constructor: prop → clase de servicio, prop → tabla, prop → cola.
  const propServicio: Record<string, string> = {};
  const propTabla: Record<string, string> = {};
  const propCola: Record<string, string> = {};
  for (const ctor of s.matchAll(/constructor\s*\(([\s\S]*?)\)\s*\{/g)) {
    // También los repositorios propios (`ContratoRepository`), no solo `Repository<T>`: sin
    // esto `ContratosService.cambiarEstado()` figuraba escribiendo `clientes` pero no
    // `servicios`, que es justo al revés de lo que ocurre.
    for (const [, prop, clase] of ctor[1].matchAll(/(\w+)\s*:\s*(\w+(?:Service|Repository))\b/g)) {
      propServicio[prop] = clase;
    }
    // (los repositorios se detectan a nivel de fichero, más abajo)
    // Sin esto, `.add(` capturaba cualquier `Set.add()` y el informe se llenaba de basura.
    // (nota: `@InjectQueue` sí vive siempre en el constructor)
    for (const [, cola, prop] of ctor[1].matchAll(/@InjectQueue\(\s*(?:[A-Z_]+\.)?['"]?([\w.-]+)['"]?\s*\)[^,)]*?(\w+)\s*:\s*Queue/g)) {
      propCola[prop] = cola;
    }
  }

  // Un `Repository<T>` puede llegar por el constructor (`@InjectRepository`) o declararse como
  // campo de clase e inicializarse en el cuerpo (`this.repo = ds.getRepository(Contrato)`), que
  // es como lo hacen los repositorios propios. Buscar solo en el constructor dejaba fuera todas
  // las escrituras de `ContratoRepository` — las más importantes del Core.
  for (const [, prop, entidad] of s.matchAll(/(\w+)\s*:\s*Repository<(\w+)>/g)) {
    if (tablaDeEntidad[entidad]) propTabla[prop] = tablaDeEntidad[entidad];
  }

  // Declaraciones de método a indentación 2. La extensión de cada uno llega hasta el siguiente.
  const anclas: Array<{ nombre: string; vis: Metodo['visibilidad']; ini: number; abre: number; clase: string }> = [];
  for (const m of s.matchAll(/^ {2}(?:(public|private|protected)\s+)?(?:async\s+)?(\w+)\s*\(/gm)) {
    anclas.push({ nombre: m[2], vis: (m[1] as Metodo['visibilidad']) ?? 'public',
                  ini: m.index!, abre: m.index! + m[0].length - 1, clase: claseEn(m.index!) });
  }
  // Métodos de la propia clase, para poder seguir `this._helper()`. Sin esto el árbol de un
  // flujo se detiene en el primer método privado y un `provisionarFtth()` de 600 líneas
  // aparece sin escribir nada.
  const propiosDe: Record<string, Set<string>> = {};
  for (const a of anclas) (propiosDe[a.clase] ??= new Set()).add(a.nombre);

  for (let i = 0; i < anclas.length; i++) {
    const a = anclas[i];
    if (a.nombre === 'constructor') continue;
    const fin = i + 1 < anclas.length ? anclas[i + 1].ini : s.length;
    const cuerpo = s.slice(a.ini, fin);

    // Tipo de retorno: tras el paréntesis que cierra los parámetros.
    let prof = 0, j = a.abre;
    for (; j < s.length; j++) { if (s[j] === '(') prof++; else if (s[j] === ')') { prof--; if (!prof) break; } }
    const retorno = (/^\s*:\s*([\s\S]+?)\s*\{/.exec(s.slice(j + 1, j + 400)) || [, ''])[1]
      .replace(/\s+/g, ' ').trim();

    const met: Metodo = {
      clase: claseEn(a.ini), modulo: mod, fichero: rel, linea: lineaDe(a.ini),
      nombre: a.nombre, visibilidad: a.vis, retorno,
      llamadas: [], escribe: [], emite: [], encola: [],
    };

    for (const c of cuerpo.matchAll(/\bthis\.(\w+)\.(\w+)\s*\(/g)) {
      const clase = propServicio[c[1]];
      if (clase) met.llamadas.push({ clase, metodo: c[2] });
    }
    for (const c of cuerpo.matchAll(/\bthis\.(\w+)\s*\(/g)) {
      if (c[1] !== a.nombre && propiosDe[met.clase]?.has(c[1])) {
        met.llamadas.push({ clase: met.clase, metodo: c[1] });
      }
    }
    // El `(?<!\bFOR\s+)` evita leer `FOR UPDATE SKIP LOCKED` como una escritura a una tabla
    // llamada `skip`.
    for (const w of cuerpo.matchAll(/(?<!\bFOR\s+)\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(\w+)/gi)) {
      met.escribe.push({ tabla: w[2].toLowerCase(), op: w[1].toUpperCase().split(/\s+/)[0] });
    }
    for (const w of cuerpo.matchAll(new RegExp(`\\bthis\\.(\\w+)\\.(${OPS_ORM})\\(`, 'g'))) {
      if (propTabla[w[1]]) met.escribe.push({ tabla: propTabla[w[1]], op: w[2] });
    }
    for (const w of cuerpo.matchAll(new RegExp(`getRepository\\((\\w+)\\)\\s*\\.\\s*(${OPS_ORM})\\(`, 'g'))) {
      if (tablaDeEntidad[w[1]]) met.escribe.push({ tabla: tablaDeEntidad[w[1]], op: w[2] });
    }
    for (const e of cuerpo.matchAll(/\.emit\(\s*'([^']+)'/g)) met.emite.push(e[1]);
    for (const e of cuerpo.matchAll(/\bthis\.(\w+)\.add\(\s*(?:[A-Z_]+\.)?['"]?([\w.-]+)['"]?/g)) {
      if (propCola[e[1]]) met.encola.push(`${e[2]} @ ${propCola[e[1]]}`);
    }

    // `@OnEvent('x')` va justo encima de la declaración.
    const encima = s.slice(Math.max(0, a.ini - 200), a.ini);
    const oe = /@OnEvent\(\s*'([^']+)'[\s\S]*$/.exec(encima);
    if (oe) { met.escuchaEvento = oe[1]; consumidores.push({ evento: oe[1], clase: met.clase, metodo: met.nombre, modulo: mod }); }
    // Quién procesa un trabajo se lee de su decorador, no de parecidos entre nombres.
    const pr = /@Process\(\s*\{?\s*(?:name:\s*)?(?:[A-Z_]+\.)?['"]?([\w.-]+)['"]?[\s\S]*$/.exec(encima);
    if (pr) met.procesaJob = pr[1];

    metodos.push(met);
  }

  // Endpoints, con el método de servicio al que delegan.
  const ctrl = /@Controller\('([^']*)'\)[\s\S]{0,200}?export class (\w+)/.exec(s);
  if (ctrl) {
    for (const m of s.matchAll(/@(Get|Post|Patch|Put|Delete)\(\s*'?([^')]*)'?\s*\)([\s\S]{0,600}?)\n {2}(?:async\s+)?(\w+)\s*\(/g)) {
      const handler = metodos.find((x) => x.clase === ctrl[2] && x.nombre === m[4]);
      endpoints.push({
        modulo: mod, verbo: m[1].toUpperCase(),
        ruta: `/${ctrl[1]}${m[2] ? '/' + m[2] : ''}`.replace(/\/+/g, '/'),
        controlador: ctrl[2], metodo: m[4],
        delega: [...new Set((handler?.llamadas ?? []).map((c) => `${c.clase}.${c.metodo}`))],
      });
    }
  }
}

const buscar = (clase: string, metodo: string) => metodos.find((m) => m.clase === clase && m.nombre === metodo);

// ── Clasificación del retorno (bloque 3) ────────────────────────────────────
const desenvolver = (t: string) => (/^Promise<([\s\S]*)>$/.exec(t.trim()) || [, t])[1].trim();

function clasificarRetorno(t: string): string {
  if (!t) return 'sin anotar (inferido)';
  const x = desenvolver(t);
  if (/^void$/.test(x)) return 'void';
  if (/^boolean$/.test(x)) return 'boolean';
  if (/^(any|unknown)$/.test(x)) return 'sin tipar (any)';
  if (/^ResultadoOperacion/.test(x)) return 'ResultadoOperacion';
  if (/^(string|number)$/.test(x)) return x === 'string' ? 'string (id o texto)' : 'number';
  if (/^\w+\[\]$|^Array</.test(x)) return 'colección';
  if (/^\{/.test(x)) return 'objeto anónimo';
  if (/\|\s*null$/.test(x)) return 'objeto o null';
  return 'objeto';
}

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
