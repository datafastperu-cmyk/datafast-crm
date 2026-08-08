import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// Desviación B-14 (2026-08-08). ADR-011 declara `ecosystem.config.js` fuente de verdad
// única del arranque. Había DOS autores del mismo fichero y no se conocían:
//
//   · el repositorio → api-core (RUN_CRONS=false) + worker (RUN_CRONS=true) + 3 más
//   · `installer/scripts/08-pm2.sh` → un solo `datafast-backend`, cluster, SIN RUN_CRONS
//
// El instalador escribía el suyo DESPUÉS de clonar el repositorio, así que ganaba el
// equivocado y **toda instalación nueva nacía sin worker**: ningún cron llegaba a correr
// —todos empiezan con `if (RUN_CRONS !== 'true') return`—, así que no se emitían facturas,
// no se cortaba a ningún moroso, no se reactivaba a nadie al pagar y no se drenaba el
// outbox hacia la OLT ni MikroTik. Sin un solo error.
//
// Estos tests son la barrera. La regla escrita en un ADR ya existía y no impidió nada.
// ═══════════════════════════════════════════════════════════════════════════
describe('El arranque tiene un solo autor (B-14)', () => {
  const RAIZ = join(__dirname, '..', '..', '..');

  it('el ecosystem declara los cinco procesos, y el worker ejecuta los crons', () => {
    // eslint-disable-next-line
    const apps = require(join(RAIZ, 'ecosystem.config.js')).apps as Array<{
      name: string; env?: Record<string, string>;
    }>;
    const porNombre = new Map(apps.map((a) => [a.name, a]));

    expect([...porNombre.keys()].sort()).toEqual([
      'datafast-api-core',
      'datafast-frontend',
      'datafast-whatsapp',
      'datafast-worker-auxiliary',
      'olt-automation-service',
    ]);

    // El reparto de responsabilidades, que es lo que B-14 rompía.
    expect(porNombre.get('datafast-worker-auxiliary')?.env?.RUN_CRONS).toBe('true');
    expect(porNombre.get('datafast-api-core')?.env?.RUN_CRONS).toBe('false');

    // Solo api-core migra: arrancar los dos a la vez hizo colisionar las migraciones
    // el 2026-07-21 ("duplicate key ... pg_type_typname_nsp_index"). Es ADR-010.
    expect(porNombre.get('datafast-api-core')?.env?.RUN_MIGRATIONS).toBe('true');
    expect(porNombre.get('datafast-worker-auxiliary')?.env?.RUN_MIGRATIONS).toBe('false');
  });

  // Las rutas absolutas eran la CAUSA de que el instalador generase su propio fichero: con
  // `/opt/datafast` incrustado no servía para otro directorio de instalación. Derivándolas
  // de `__dirname`, el instalador puede usar este mismo fichero y desaparece el segundo autor.
  it('el ecosystem no lleva rutas absolutas incrustadas', () => {
    const texto = readFileSync(join(RAIZ, 'ecosystem.config.js'), 'utf8');
    const lineas = texto.split(/\r?\n/);
    const infractoras = lineas
      .map((l, i) => [l, i + 1] as const)
      .filter(([l]) => /'\/opt\//.test(l) && !l.trimStart().startsWith('//'))
      .map(([l, n]) => `${n}: ${l.trim()}`);

    expect(infractoras).toEqual([]);
    expect(texto).toContain('__dirname');
  });

  it('el instalador NO genera un ecosystem propio', () => {
    const p = join(RAIZ, 'installer', 'scripts', '08-pm2.sh');
    const sh = readFileSync(p, 'utf8');

    // La firma exacta del defecto: escribir sobre el fichero del repositorio.
    const escribeEncima = /(cat|tee)\s*>[^>]*ecosystem\.config\.js/.test(sh);
    expect(escribeEncima).toBe(false);
  });

  // `datafast-backend` dejó de existir cuando el arranque se partió en dos procesos, y
  // `pm2 stop <inexistente>` no falla: no encuentra nada y sigue. Por eso cinco llamadas
  // llevaban tiempo sin hacer nada — incluida la que debía parar el ERP antes de restaurar
  // una copia de seguridad, que corría con el backend escribiendo encima.
  it('ningún script invoca el proceso muerto `datafast-backend`', () => {
    const dir = join(RAIZ, 'installer', 'scripts');
    const infractores: string[] = [];

    for (const fichero of readdirSync(dir)) {
      if (!fichero.endsWith('.sh')) continue;
      // El instalador de desarrollo monta un proceso único a propósito; no es el de producción.
      if (fichero === '08-dev.sh' || fichero === '07-app-dev.sh') continue;
      const ruta = join(dir, fichero);
      if (statSync(ruta).isDirectory()) continue;

      readFileSync(ruta, 'utf8').split(/\r?\n/).forEach((linea, i) => {
        if (!/\bdatafast-backend\b/.test(linea)) return;
        if (/^\s*#/.test(linea)) return;                 // comentarios que lo citan
        infractores.push(`installer/scripts/${fichero}:${i + 1}: ${linea.trim()}`);
      });
    }

    expect(infractores).toEqual([]);
  });

  it('el arranque desplegado coincide con el del repositorio', () => {
    // Si `ecosystem.config.js` aparece modificado en el árbol de trabajo, hay alguien
    // reescribiéndolo — que es exactamente cómo empezó B-14.
    const salida = execSync('git status --porcelain ecosystem.config.js', {
      cwd: RAIZ, encoding: 'utf8',
    }).trim();
    // Vacío o solo el propio cambio en curso: lo que no puede haber es un fichero
    // no versionado ocupando ese nombre.
    expect(salida).not.toMatch(/^\?\?/);
  });
});
