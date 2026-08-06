import * as fs   from 'fs';
import * as path from 'path';

/**
 * Ningún SQL puede comparar `contratos.estado` con un valor que no exista en el enum.
 *
 * Incidente 2026-08-06: `findContratosParaFacturar` filtraba por
 * `co.estado IN ('activo', 'prorroga')`. El estado 'prorroga' se eliminó del modelo —una
 * prórroga deja el contrato en 'activo' con `en_prorroga = true`— y Postgres, ante un
 * literal que no pertenece al enum, **rechaza la consulta ENTERA**:
 *
 *     invalid input value for enum estado_contrato: "prorroga"
 *
 * No es que devolviera menos filas: no devolvía ninguna y la generación de facturas moría.
 * Estuvo latente porque esa ruta corría un día al mes; cuando la emisión pasó a evaluarse
 * a diario (05/08) empezó a fallar cada madrugada, con el parque entero sin facturar.
 *
 * El mismo literal huérfano estaba en dos consultas más del módulo de velocidad, que
 * habrían fallado igual en cuanto se ejecutaran.
 *
 * Este test lee el código fuente en vez de la base de datos a propósito: detecta el
 * problema en CI, antes de desplegar, sin necesitar Postgres levantado.
 */

// Los valores del enum `estado_contrato` en la BD. Si se añade uno, se añade aquí; ese es
// el punto donde alguien se entera de que la lista es un contrato con la base de datos.
const ESTADOS_VALIDOS = new Set([
  'activo',
  'baja_definitiva',
  'cortado',
  'moroso',
  'pendiente_activacion',
  'suspendido',
]);

const RAIZ = path.join(__dirname, '..', '..');

function archivosTs(dir: string, acc: string[] = []): string[] {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === 'node_modules' || entrada.name === 'migrations') continue;
      archivosTs(completo, acc);
    } else if (entrada.name.endsWith('.ts') && !entrada.name.endsWith('.spec.ts')) {
      acc.push(completo);
    }
  }
  return acc;
}

describe('Literales de estado_contrato en SQL (incidente 06/08)', () => {
  it('ninguna consulta compara co.estado con un valor fuera del enum', () => {
    // Captura el grupo COMPLETO de la comparación: `('activo','prorroga')` en un IN, o
    // `'activo'` en una igualdad. Un patrón perezoso se quedaba con el primer literal y
    // dejaba pasar justo el segundo, que era el roto — el test pasaba siempre.
    // Solo el alias de CONTRATOS (`co.` o `contratos.`). Sin acotarlo, capturaba también
    // `f.estado IN ('emitida','pagada_parcial')`, que son estados de FACTURA y válidos en
    // su propio enum: un test que grita por lo correcto acaba ignorándose.
    const patron = /\b(?:co|contratos)\.estado(?:::text)?\s*(?:=|IN)\s*(\([^)]*\)|'[a-z_]+')/gi;
    const infracciones: string[] = [];

    for (const archivo of archivosTs(RAIZ)) {
      const contenido = fs.readFileSync(archivo, 'utf8');
      // Solo las líneas que están dentro de SQL: las comparaciones en TypeScript usan el
      // enum EstadoContrato y las valida el compilador.
      for (const coincidencia of contenido.matchAll(patron)) {
        const literales = coincidencia[1].match(/'([a-z_]+)'/g) ?? [];
        for (const literal of literales) {
          const valor = literal.replace(/'/g, '');
          if (!ESTADOS_VALIDOS.has(valor)) {
            const linea = contenido.slice(0, coincidencia.index).split('\n').length;
            infracciones.push(
              `${path.relative(RAIZ, archivo)}:${linea} → '${valor}' no existe en estado_contrato`,
            );
          }
        }
      }
    }

    expect(infracciones).toEqual([]);
  });
});
