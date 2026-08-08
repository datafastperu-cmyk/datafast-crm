/**
 * Barrido de autorización en endpoints mutantes (desviación B-3, política PS-05).
 *
 * `RolesGuard` deja pasar a cualquier usuario autenticado cuando el endpoint no declara ni
 * `@Roles` ni `@RequirePermission`:
 *
 *     if (!requiredRoles?.length && !requiredPermissions?.length) return true;
 *
 * Así que un POST o un DELETE sin decorar **no está protegido por rol al módulo**: no está
 * protegido en absoluto más allá de estar autenticado. Ese es el agujero real de B-3, y no
 * es el mismo que «le falta permiso fino».
 *
 * Clasifica cada endpoint mutante en cuatro estados:
 *
 *   ABIERTO      ni rol ni permiso, ni en el método ni en la clase → cualquiera autenticado
 *   ROL          protegido por rol (grueso, pero protegido)
 *   PERMISO      con permiso fino — el objetivo de PS-05
 *   ROL-FANTASMA exige un rol que NO EXISTE → inalcanzable para todo el mundo
 *
 * Informe por consola: `npm run autorizacion:check`
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const SRC = join(__dirname, '..', '..');

/**
 * Roles que existen de verdad. Verificados contra la base de producción el 2026-08-08.
 *
 * No se deducen del `seed`: la instalación tenía diez y el seed solo crea cinco — los otros
 * se añadieron después. Esta lista es la referencia para detectar roles fantasma; si una
 * instalación añade uno nuevo, se añade aquí.
 */
const ROLES_REALES = new Set([
  'Administrador', 'Super Administrador', 'Supervisor', 'Cajero', 'Vendedor',
  'Técnico', 'Atención al Cliente', 'Cobranza', 'Operador NOC', 'Invitado',
]);

/**
 * Exenciones justificadas: endpoints donde el usuario actúa **sobre sí mismo**. Exigir un rol
 * sería incorrecto — cualquier usuario autenticado debe poder cerrar su sesión o cambiar su
 * propia contraseña.
 */
const EXENTOS = [
  {
    fichero: 'modules/auth/auth.controller.ts',
    rutas: ['logout', 'change-password'],
    motivo: 'El usuario actúa sobre su propia sesión y su propia contraseña',
  },
];

export interface EndpointMutante {
  fichero: string; linea: number; clase: string; verbo: string; ruta: string; fantasmas: string[];
}

const ficheros = (dir: string): string[] => {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'dist') continue;
    const r = join(dir, e);
    if (statSync(r).isDirectory()) { out.push(...ficheros(r)); continue; }
    if (e.endsWith('.controller.ts')) out.push(r);
  }
  return out;
};

const rolesDe = (texto: string): string[] => {
  const out: string[] = [];
  for (const m of texto.matchAll(/@Roles\(([^)]*)\)/g)) {
    for (const r of m[1].matchAll(/'([^']+)'/g)) out.push(r[1]);
  }
  return out;
};

export function analizar(): EndpointMutante[] {
  const hallazgos: EndpointMutante[] = [];

  for (const fichero of ficheros(SRC)) {
    const rel = fichero.slice(SRC.length + 1).split(sep).join('/');
    const lineas = readFileSync(fichero, 'utf8').split(/\r?\n/);

    // Decoradores de la CLASE: todo lo que hay entre @Controller y `export class`.
    const iCtrl = lineas.findIndex((l) => /^\s*@Controller\(/.test(l));
    const iClase = lineas.findIndex((l) => /^\s*export class /.test(l));
    const cabecera = iCtrl >= 0 && iClase > iCtrl ? lineas.slice(0, iClase).join('\n') : '';
    const rolesClase = rolesDe(cabecera);
    const permisoClase = /@RequirePermission\(/.test(cabecera);
    const publicoClase = /@Public\(\)/.test(cabecera);

    // Un guard propio significa que ese endpoint NO se autoriza por el `RolesGuard` del ERP.
    // `portal` usa `PortalJwtGuard`: sus endpoints son del abonado, y exigirles un rol del
    // ERP sería justo lo contrario de lo correcto. Contarlos como desprotegidos inflaba la
    // cifra en diez.
    //
    // Se comprueba en la clase Y en cada método: en `portal` el decorador está por método,
    // y buscarlo solo en la cabecera daba cero — el barrido no detectaba ninguno.
    const GUARD_PROPIO = /@UseGuards\(\s*(?!JwtAuthGuard\b|RolesGuard\b)[A-Z]\w*Guard/;
    const guardPropioClase = GUARD_PROPIO.test(cabecera);

    lineas.forEach((linea, i) => {
      if (!/^\s*@(Post|Patch|Put|Delete)\(/.test(linea)) return;

      // Decoradores del método: se mira hacia arriba y hacia abajo hasta la firma.
      //
      // Se ATRAVIESAN los comentarios y las líneas en blanco. La primera versión paraba en
      // ellos, y por eso daba por «sin autorización» a un endpoint cuyo `@Roles` estaba
      // debajo de un comentario explicativo — que es justo donde se pone un comentario. Lo
      // detectó el propio test al fallar sobre un endpoint que sí acababa de protegerse.
      const decoradorOSalto = (l: string) => /^\s*(@|\/\/|\*|\/\*)/.test(l) || /^\s*$/.test(l);
      let ini = i;
      while (ini > 0 && decoradorOSalto(lineas[ini - 1])) ini--;
      let fin = i;
      while (fin < lineas.length - 1 && decoradorOSalto(lineas[fin + 1])) fin++;
      const bloque = lineas.slice(ini, fin + 1).join('\n');

      const verbo = /@(\w+)\(/.exec(linea)[1];
      const ruta = (/@\w+\(\s*'([^']*)'/.exec(linea) || [, ''])[1];
      const roles = [...rolesDe(bloque), ...rolesClase];
      const permiso = /@RequirePermission\(/.test(bloque) || permisoClase;
      const publico = /@Public\(\)/.test(bloque) || publicoClase;

      const fantasmas = roles.filter((r) => !ROLES_REALES.has(r));
      let clase;
      if (publico) clase = 'PUBLICO';
      else if (guardPropioClase || GUARD_PROPIO.test(bloque)) clase = 'GUARD-PROPIO';
      else if (EXENTOS.some((e) => rel.endsWith(e.fichero) && e.rutas.includes(ruta))) clase = 'EXENTO';
      else if (fantasmas.length && fantasmas.length === roles.length) clase = 'ROL-FANTASMA';
      else if (permiso) clase = 'PERMISO';
      else if (roles.length) clase = 'ROL';
      else clase = 'ABIERTO';

      hallazgos.push({ fichero: rel, linea: i + 1, clase, verbo, ruta, fantasmas });
    });
  }
  return hallazgos;
}
