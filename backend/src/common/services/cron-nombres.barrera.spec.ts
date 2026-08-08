import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// Barrera, no documentación.
//
// `CronLatidoService` hace latir a todo cron registrado en el SchedulerRegistry, pero no
// puede hacer nada con un `@Cron()` sin `name:`: NestJS le asigna un UUID v4 nuevo en cada
// arranque (`scheduler.orchestrator.js` → `addCron`: `options.name || uuid.v4()`), y usar
// eso como identidad dejaría una fila huérfana por cron y por despliegue.
//
// La regla "todo @Cron lleva name" escrita en una guía se incumple en el primer cron que
// alguien añada con prisa, y se incumple en silencio: el cron funciona igual, solo deja de
// ser observable. Escrita aquí, no.
//
// El 2026-08-07, cuando se midió por primera vez, 26 de los 29 `@Cron` del ERP no tenían
// nombre y 46 de los 47 jobs programados no latían.
// ═══════════════════════════════════════════════════════════════════════════
describe('Todo @Cron declara un `name:` estable (A-3)', () => {
  const RAIZ = join(__dirname, '..', '..');

  const ficherosTs = (dir: string): string[] => {
    const salida: string[] = [];
    for (const entrada of readdirSync(dir)) {
      if (entrada === 'node_modules' || entrada === 'dist') continue;
      const ruta = join(dir, entrada);
      if (statSync(ruta).isDirectory()) { salida.push(...ficherosTs(ruta)); continue; }
      if (entrada.endsWith('.ts') && !entrada.endsWith('.spec.ts')) salida.push(ruta);
    }
    return salida;
  };

  it('ningún @Cron se queda con la clave UUID que NestJS inventa cuando no hay nombre', () => {
    const infractores: string[] = [];
    const nombres = new Map<string, string>();

    for (const fichero of ficherosTs(RAIZ)) {
      const lineas = readFileSync(fichero, 'utf8').split(/\r?\n/);
      lineas.forEach((linea, i) => {
        if (!linea.trimStart().startsWith('@Cron(')) return;
        const ubicacion = `${fichero.slice(RAIZ.length + 1).replace(/\\/g, '/')}:${i + 1}`;

        const conNombre = /name:\s*'([^']+)'/.exec(linea);
        if (!conNombre) { infractores.push(ubicacion); return; }

        // Dos crons con el mismo nombre comparten fila de latido: el segundo pisa al
        // primero y uno de los dos se vuelve invisible sin que nada falle.
        const previo = nombres.get(conNombre[1]);
        if (previo) infractores.push(`${ubicacion} — nombre duplicado con ${previo}`);
        nombres.set(conNombre[1], ubicacion);
      });
    }

    expect(infractores).toEqual([]);
  });
});
