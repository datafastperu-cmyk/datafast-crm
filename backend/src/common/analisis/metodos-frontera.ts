import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * Detección de métodos y de operaciones de frontera — extraído de `auditoria-interacciones.ts`
 * como módulo compartido (Ola 1, 2026-08-16) para que el informe E-0.2 y la barrera de E03-03
 * midan «operación de frontera» con **el mismo instrumento**, no con dos regex
 * parecidas-pero-no-iguales — el mismo criterio que unificó la detección de escritores en la
 * Ola 0 (`escritores-tabla.ts`).
 *
 * DEFINICIÓN OPERATIVA DE «OPERACIÓN DE FRONTERA»** (congelada aquí, no en el informe):
 * un método **público** de una clase `*Service` que **al menos otro módulo distinto** invoca
 * vía `this.<servicioInyectado>.<método>()`. Es exactamente lo que el Bloque 2/3 de
 * `auditoria-interacciones.ts` ya medía como «invocado desde otro módulo» — aquí queda con
 * nombre y un solo lugar donde vive.
 *
 * LÍMITES DECLARADOS (heredados de `auditoria-interacciones.ts`, sin ampliar ni reducir):
 *   · La extensión de un método se delimita por la siguiente declaración de método de la misma
 *     clase, a indentación 2. Un método declarado con otra indentación no se ve.
 *   · Se detectan llamadas por servicio inyectado en el constructor. Un `moduleRef.get()` o una
 *     llamada dinámica no se ven.
 *   · Los eventos se detectan por `.emit('nombre')` y `@OnEvent('nombre')`, literales o
 *     constantes `export const X = { A: 'a' }` / `export enum X { A = 'a' }` resueltas.
 *   · Es un SUELO, no un total.
 */

export interface MetodoInfo {
  clase: string;
  modulo: string;
  fichero: string;
  linea: number;
  nombre: string;
  visibilidad: 'public' | 'private' | 'protected';
  retorno: string;
  /** Cuerpo crudo del método (sin comentarios), para escanear qué lanza o qué devuelve. */
  cuerpo: string;
  llamadas: Array<{ clase: string; metodo: string }>;
  escribe: Array<{ tabla: string; op: string }>;
  emite: string[];
  encola: string[];
  escuchaEvento?: string;
  procesaJob?: string;
}

export interface EndpointInfo {
  modulo: string; verbo: string; ruta: string; controlador: string; metodo: string; delega: string[];
}

export interface AnalisisCodigo {
  metodos: MetodoInfo[];
  endpoints: EndpointInfo[];
  consumidores: Array<{ evento: string; clase: string; metodo: string; modulo: string }>;
}

const OPS_ORM = 'save|insert|update|upsert|delete|remove|softDelete|softRemove|restore|increment|decrement';

function ficherosTs(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'migrations') out.push(...ficherosTs(p)); }
    else if (e.name.endsWith('.ts') && !e.name.includes('.spec.')) out.push(p);
  }
  return out;
}

// Preserva las líneas (sustituye cada carácter de un comentario de bloque por un espacio, en
// vez de borrarlo) para que los números de línea reportados sigan siendo exactos.
export const sinComentarios = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
   .replace(/(^|[^:])\/\/.*$/gm, '$1');

function moduloDe(srcDir: string, fichero: string): string {
  const rel = relative(srcDir, fichero).split(sep).join('/');
  const m = /^modules\/([^/]+)\//.exec(rel);
  return m ? m[1] : (rel.startsWith('common/') ? 'common' : 'raiz');
}

/** Analiza todo el código: métodos (con escrituras, eventos, colas), endpoints y consumidores. */
export function analizarCodigo(srcDir: string): AnalisisCodigo {
  const ficheros = ficherosTs(srcDir);

  // Nombres de evento declarados como constantes o enum.
  const constanteEvento: Record<string, string> = {};
  for (const f of ficheros) {
    const s = readFileSync(f, 'utf8');
    for (const bloque of s.matchAll(/export const (\w+)\s*=\s*\{([\s\S]*?)\n\}/g)) {
      for (const [, campo, valor] of bloque[2].matchAll(/(\w+)\s*:\s*'([^']+)'/g)) {
        constanteEvento[`${bloque[1]}.${campo}`] = valor;
      }
    }
    for (const e of s.matchAll(/export enum (\w+)\s*\{([\s\S]*?)\n\}/g)) {
      for (const [, campo, valor] of e[2].matchAll(/(\w+)\s*=\s*'([^']+)'/g)) {
        constanteEvento[`${e[1]}.${campo}`] = valor;
      }
    }
  }
  const resolverEvento = (bruto: string): string | null => {
    const lit = /^['"]([^'"]+)['"]$/.exec(bruto.trim());
    if (lit) return lit[1];
    const ref = bruto.trim();
    return constanteEvento[ref] ?? (/^\w+\.\w+$/.test(ref) ? `${ref} (no resuelto)` : null);
  };

  const tablaDeEntidad: Record<string, string> = {};
  for (const f of ficheros) {
    for (const [, tabla, clase] of readFileSync(f, 'utf8')
         .matchAll(/@Entity\('(\w+)'\)[\s\S]{0,300}?export class (\w+)/g)) {
      tablaDeEntidad[clase] = tabla;
    }
  }

  const metodos: MetodoInfo[] = [];
  const consumidores: AnalisisCodigo['consumidores'] = [];
  const endpoints: EndpointInfo[] = [];

  for (const f of ficheros) {
    const s = sinComentarios(readFileSync(f, 'utf8'));
    const mod = moduloDe(srcDir, f);
    const rel = relative(srcDir, f).split(sep).join('/');
    const lineaDe = (i: number) => s.slice(0, i).split('\n').length;

    const clases = [...s.matchAll(/export class (\w+)/g)].map((m) => ({ nombre: m[1], desde: m.index! }));
    if (!clases.length) continue;
    const claseEn = (i: number) => {
      let c = clases[0].nombre;
      for (const k of clases) if (k.desde <= i) c = k.nombre; else break;
      return c;
    };

    const propServicio: Record<string, string> = {};
    const propTabla: Record<string, string> = {};
    const propCola: Record<string, string> = {};
    for (const ctor of s.matchAll(/constructor\s*\(([\s\S]*?)\)\s*\{/g)) {
      for (const [, prop, clase] of ctor[1].matchAll(/(\w+)\s*:\s*(\w+(?:Service|Repository))\b/g)) {
        propServicio[prop] = clase;
      }
      for (const [, cola, prop] of ctor[1].matchAll(/@InjectQueue\(\s*(?:[A-Z_]+\.)?['"]?([\w.-]+)['"]?\s*\)[^,)]*?(\w+)\s*:\s*Queue/g)) {
        propCola[prop] = cola;
      }
    }
    for (const [, prop, entidad] of s.matchAll(/(\w+)\s*:\s*Repository<(\w+)>/g)) {
      if (tablaDeEntidad[entidad]) propTabla[prop] = tablaDeEntidad[entidad];
    }

    const anclas: Array<{ nombre: string; vis: MetodoInfo['visibilidad']; ini: number; abre: number; clase: string }> = [];
    for (const m of s.matchAll(/^ {2}(?:(public|private|protected)\s+)?(?:async\s+)?(\w+)\s*\(/gm)) {
      anclas.push({ nombre: m[2], vis: (m[1] as MetodoInfo['visibilidad']) ?? 'public',
                    ini: m.index!, abre: m.index! + m[0].length - 1, clase: claseEn(m.index!) });
    }
    const propiosDe: Record<string, Set<string>> = {};
    for (const a of anclas) (propiosDe[a.clase] ??= new Set()).add(a.nombre);

    for (let i = 0; i < anclas.length; i++) {
      const a = anclas[i];
      if (a.nombre === 'constructor') continue;
      const fin = i + 1 < anclas.length ? anclas[i + 1].ini : s.length;
      const cuerpo = s.slice(a.ini, fin);

      let prof = 0, j = a.abre;
      for (; j < s.length; j++) { if (s[j] === '(') prof++; else if (s[j] === ')') { prof--; if (!prof) break; } }
      const retorno = (/^\s*:\s*([\s\S]+?)\s*\{/.exec(s.slice(j + 1, j + 400)) || [, ''])[1]
        .replace(/\s+/g, ' ').trim();

      const met: MetodoInfo = {
        clase: claseEn(a.ini), modulo: mod, fichero: rel, linea: lineaDe(a.ini),
        nombre: a.nombre, visibilidad: a.vis, retorno, cuerpo,
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
      for (const w of cuerpo.matchAll(/(?<!\bFOR\s+)\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(\w+)/gi)) {
        met.escribe.push({ tabla: w[2].toLowerCase(), op: w[1].toUpperCase().split(/\s+/)[0] });
      }
      for (const w of cuerpo.matchAll(new RegExp(`\\bthis\\.(\\w+)\\.(${OPS_ORM})\\(`, 'g'))) {
        if (propTabla[w[1]]) met.escribe.push({ tabla: propTabla[w[1]], op: w[2] });
      }
      for (const w of cuerpo.matchAll(new RegExp(`getRepository\\((\\w+)\\)\\s*\\.\\s*(${OPS_ORM})\\(`, 'g'))) {
        if (tablaDeEntidad[w[1]]) met.escribe.push({ tabla: tablaDeEntidad[w[1]], op: w[2] });
      }
      for (const e of cuerpo.matchAll(/\.emit\(\s*([^,)]+)/g)) {
        const n = resolverEvento(e[1]);
        if (n) met.emite.push(n);
      }
      for (const e of cuerpo.matchAll(/\bthis\.(\w+)\.add\(\s*(?:[A-Z_]+\.)?['"]?([\w.-]+)['"]?/g)) {
        if (propCola[e[1]]) met.encola.push(`${e[2]} @ ${propCola[e[1]]}`);
      }

      const encima = s.slice(Math.max(0, a.ini - 200), a.ini);
      const oe = /@OnEvent\(\s*([^,)]+)[\s\S]*$/.exec(encima);
      const nombreOe = oe && resolverEvento(oe[1]);
      if (nombreOe) {
        met.escuchaEvento = nombreOe;
        consumidores.push({ evento: nombreOe, clase: met.clase, metodo: met.nombre, modulo: mod });
      }
      const pr = /@Process\(\s*\{?\s*(?:name:\s*)?(?:[A-Z_]+\.)?['"]?([\w.-]+)['"]?[\s\S]*$/.exec(encima);
      if (pr) met.procesaJob = pr[1];

      metodos.push(met);
    }

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

  return { metodos, endpoints, consumidores };
}

/** Mismo criterio de clasificación que `auditoria-interacciones.ts` Bloque 3. */
export function clasificarRetorno(t: string): string {
  const desenvolver = (x: string) => (/^Promise<([\s\S]*)>$/.exec(x.trim()) || [, x])[1].trim();
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

/**
 * Operación de frontera: método público de una clase `*Service`, invocado desde al menos un
 * módulo distinto del suyo. Es la definición que congela F-0.1 §9.1 (Ola 1).
 */
export function operacionesDeFrontera(metodos: MetodoInfo[]): MetodoInfo[] {
  return metodos.filter((m) =>
    m.visibilidad === 'public' &&
    /Service$/.test(m.clase) &&
    !/^(onModuleInit|onModuleDestroy|onApplicationBootstrap|beforeApplicationShutdown)$/.test(m.nombre) &&
    metodos.some((x) => x.modulo !== m.modulo && x.llamadas.some((c) => c.clase === m.clase && c.metodo === m.nombre)),
  );
}

/**
 * Registro DECLARADO de extensiones locales y transitorias de `ResultadoOperacion`
 * (Ola 1, grupo 3a, 2026-08-16).
 *
 * Por qué existe: `clasificarRetorno()` reconoce el vocabulario de dominio por el NOMBRE del
 * tipo (`/^ResultadoOperacion/`), a propósito — no evalúa la forma estructural, porque eso
 * convertiría al medidor en un mini-compilador. Un método que necesita cargar un payload que
 * `ResultadoOperacion` no lleva a propósito (`SmartoltApiService.aprovisionarOnu()`, ver su
 * propio comentario — E02-10/E04-10 prohíben ese payload en el tipo compartido) declara un
 * tipo LOCAL que envuelve las seis clases con el campo extra. Ese método SÍ habla el
 * vocabulario de dominio — pero el medidor, mirando solo el nombre, lo cuenta como si no lo
 * hablara. Es el error 15-frente-a-23 de la Ola 0 otra vez: dos cifras sobre el mismo hecho.
 *
 * La corrección NO es enseñarle el regex a reconocer `ResultadoAprovisionarOnu` — eso
 * maquillaría el medidor con una excepción ad-hoc que crece sin control la próxima vez que
 * alguien necesite lo mismo. La corrección es declarar la excepción AQUÍ, una vez, con su
 * fecha de retiro, y que el cómputo de «operaciones sin ResultadoOperacion» (usado por F-0.1
 * §9.1 para el ancho de E03-03) reste estas entradas explícitamente — la deuda queda CONTADA
 * (PF-3), no oculta y no comentada.
 *
 * TÉCHO: cuántas extensiones siguen vivas. Solo puede BAJAR (cuando el binding de la Ola 3
 * retire una), nunca subir sin que la entrada se declare aquí primero. Ver
 * `extensiones-transitorias.spec.ts`.
 */
export interface ExtensionTransitoria {
  /** Nombre de la clase `*Service` dueña del método. */
  clase: string;
  /** Nombre del método cuyo retorno usa la extensión. */
  metodo: string;
  /** Nombre del tipo local (el que aparece en la firma, ej. `ResultadoAprovisionarOnu`). */
  tipo: string;
  /** Dónde vive la declaración del tipo — para que quien retire la deuda sepa qué tocar. */
  archivo: string;
  /** Hito que debe retirarla. No es una fecha: es la condición de cierre. */
  retiro: string;
  /** Por qué no es directamente `ResultadoOperacion`. */
  razon: string;
}

export const EXTENSIONES_TRANSITORIAS_RESULTADO_OPERACION: ExtensionTransitoria[] = [
  {
    clase: 'SmartoltApiService',
    metodo: 'aprovisionarOnu',
    tipo: 'ResultadoAprovisionarOnu',
    archivo: 'backend/src/modules/smartolt/smartolt-api.service.ts',
    retiro: 'Ola 3 (cuando el binding del módulo posea el identificador y el Core deje de necesitarlo)',
    razon: 'Payload `onu` (el id que SmartOLT asigna) que el llamador realmente necesita — ResultadoOperacion no lleva payload a propósito (E02-10/E04-10).',
  },
];

/**
 * Operaciones de frontera que NO hablan `ResultadoOperacion` — ni literalmente (el tipo
 * compartido) ni por una extensión DECLARADA en el registro de arriba. Es el «ancho» que
 * F-0.1 §9.1 recongela en cada lote de la Ola 1: la cuenta honesta, ya reconciliada contra la
 * deuda transitoria en vez de dejarla como una discrepancia sin explicar.
 */
export function operacionesSinResultadoOperacion(metodos: MetodoInfo[]): MetodoInfo[] {
  const declaradas = new Set(
    EXTENSIONES_TRANSITORIAS_RESULTADO_OPERACION.map((e) => `${e.clase}.${e.metodo}`),
  );
  return operacionesDeFrontera(metodos).filter((m) =>
    clasificarRetorno(m.retorno) !== 'ResultadoOperacion' &&
    !declaradas.has(`${m.clase}.${m.nombre}`),
  );
}
