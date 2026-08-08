import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// Prerrequisito de la desviación B-15: la aplicación se conecta a PostgreSQL como
// SUPERUSUARIO, y para dejar de hacerlo no puede ejecutar DDL en tiempo de ejecución.
//
// Había uno solo, y bastaba para bloquearlo todo: `generarCodigoCliente` hacía
// `CREATE SEQUENCE IF NOT EXISTS` en cada alta de cliente. Un único `CREATE` obliga a
// conceder `CREATE` sobre el esquema, y con eso el rol deja de ser mínimo.
//
// Y no bastaba con que el objeto ya existiera: **PostgreSQL comprueba el permiso del esquema
// ANTES de evaluar el `IF NOT EXISTS`**. Medido contra la base de producción el 2026-08-08
// con un rol mínimo de prueba: `permission denied for schema public` sobre una secuencia ya
// creada. Sin este test, el siguiente `CREATE INDEX` "inofensivo" en un servicio volvería a
// atar la aplicación al superusuario, y se descubriría el día del cambio de rol.
//
// El esquema solo cambia por migración: es PA-14, y esto lo hace exigible.
// ═══════════════════════════════════════════════════════════════════════════
describe('La aplicación no ejecuta DDL en tiempo de ejecución (B-15 · PA-14)', () => {
  const SRC = join(__dirname, '..');

  const ficherosTs = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
      if (e === 'node_modules' || e === 'dist') continue;
      const r = join(dir, e);
      if (statSync(r).isDirectory()) { out.push(...ficherosTs(r)); continue; }
      if (e.endsWith('.ts') && !e.endsWith('.spec.ts')) out.push(r);
    }
    return out;
  };

  const DDL = /\b(CREATE|ALTER|DROP)\s+(TABLE|INDEX|TYPE|FUNCTION|EXTENSION|VIEW|SEQUENCE|SCHEMA|TRIGGER|POLICY)\b/i;

  it('ningún servicio emite CREATE, ALTER o DROP fuera de las migraciones', () => {
    const infractores: string[] = [];

    for (const fichero of ficherosTs(SRC)) {
      const rel = fichero.slice(SRC.length + 1).split(sep).join('/');
      // Las migraciones SON el sitio del DDL. Y `schema-guard` inspecciona el esquema por
      // diseño; si algún día emitiera DDL, se le añade su propia excepción justificada.
      if (rel.startsWith('database/migrations/')) continue;

      const src = readFileSync(fichero, 'utf8');
      const lineas = src.split(/\r?\n/);

      for (const lit of src.matchAll(/`([^`]*)`/g)) {
        if (!DDL.test(lit[1])) continue;
        const nLinea = src.slice(0, lit.index).split('\n').length;

        // Los backticks también se usan para citar en los comentarios — este mismo test se
        // detectó a sí mismo la primera vez, por el comentario que explica el defecto que
        // viene a impedir. Una barrera que grita por su propia documentación se desactiva.
        if (/^\s*(\/\/|\*|\/\*)/.test(lineas[nLinea - 1] ?? '')) continue;

        infractores.push(`${rel}:${nLinea}  ${lit[1].replace(/\s+/g, ' ').trim().slice(0, 90)}`);
      }
    }

    expect(infractores).toEqual([]);
  });
});
