import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * Toda `@Column` cuya propiedad sea una unión (`string | null`, `Date | null`…) DEBE
 * declarar `type` explícito.
 *
 * Con SWC —que es lo que compila este proyecto— el tipo emitido para una unión es
 * `Object`, y TypeORM aborta el arranque con:
 *
 *     DataTypeNotSupportedError: Data type "Object" in "Pago.idempotencyKey"
 *     is not supported by "postgres" database.
 *
 * Es un fallo EN FRÍO: no aparece al compilar, ni al pasar los tests, ni con el proceso ya
 * levantado. Solo se manifiesta cuando el backend arranca de verdad — y entonces entra en
 * bucle de reinicio y el ERP entero devuelve 500.
 *
 * El 2026-08-06 se coló exactamente así, y estuvo oculto porque `update.sh` llevaba once
 * horas sin reiniciar el backend: el defecto existía en el código desplegado y nadie podía
 * verlo. Salió a la luz en el primer reinicio real, con todo el ERP caído.
 *
 * Este test es barato y corre en cada suite. Un `type` que falta cuesta un backend caído.
 */
describe('Entidades — `type` explícito en columnas con tipo unión (SWC)', () => {
  const SRC = join(__dirname, '..', '..');

  const entidades = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
      const ruta = join(dir, e);
      if (statSync(ruta).isDirectory()) {
        if (e === 'node_modules') continue;
        out.push(...entidades(ruta));
      } else if (e.endsWith('.entity.ts')) {
        out.push(ruta);
      }
    }
    return out;
  };

  it('ninguna columna con unión se queda sin `type` — se emitiría como Object', () => {
    const infractoras: string[] = [];

    for (const archivo of entidades(SRC)) {
      const lineas = readFileSync(archivo, 'utf8').split('\n');

      for (let i = 0; i < lineas.length; i++) {
        // Solo el caso de una línea: `@Column({ ... })`. Los multilínea se cubren abajo.
        const m = lineas[i].match(/^\s*@Column\((\{.*\})?\)\s*$/);
        if (!m) continue;

        // La propiedad es la primera línea que no es decorador ni comentario.
        let j = i + 1;
        while (j < lineas.length && /^\s*(@|\/\/|\*|\/\*)/.test(lineas[j])) j++;
        const prop = lineas[j] ?? '';

        const esUnion    = /:\s*[\w<>[\]]+\s*\|\s*(null|undefined)/.test(prop);
        const declaraTipo = /\btype\s*:/.test(m[1] ?? '');

        if (esUnion && !declaraTipo) {
          infractoras.push(
            `${relative(SRC, archivo).split(sep).join('/')}:${j + 1} → ${prop.trim()}`,
          );
        }
      }
    }

    expect(infractoras).toEqual([]);
  });

  it('el caso concreto que tumbó producción sigue corregido', () => {
    const pago = readFileSync(join(SRC, 'modules/pagos/entities/pago.entity.ts'), 'utf8');
    const bloque = pago.slice(pago.indexOf('idempotency_key') - 200, pago.indexOf('idempotencyKey:'));
    expect(bloque).toMatch(/type:\s*'varchar'/);
  });
});
