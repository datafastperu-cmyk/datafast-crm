import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SQL_COMPROBANTE_VENCIDO, sqlEnMora, historialDesde } from './mora';

// ═══════════════════════════════════════════════════════════════════════════
// La mora es una ETIQUETA, no un estado (decisión del propietario, 2026-08-08).
//
// Primero pidió que `moroso` fuera un estado del contrato. Al medir el radio del cambio
// —`estado = 'activo'` aparece en 57 consultas— lo replanteó: *«que `moroso` no sea un
// estado, sea una etiqueta para el análisis estadístico»*.
//
// La medición que motivó el replanteo, y que este test protege:
//
//   · `cobranza.worker.detectarMorosos` filtra `co.estado = 'activo'`. Escribir
//     `estado = 'moroso'` habría sacado al abonado de esa consulta, así que **el estado
//     creado para MEDIR la morosidad habría impedido cortar a los morosos**.
//   · `address-list-reconciliador` tenía `moroso` dentro de `ESTADOS_CORTADOS`, o sea lo
//     leía como «sin servicio», al revés del enum y de la definición del propietario. Le
//     habría cortado el tráfico en MikroTik a quien debía conservarlo.
//
// Ninguna de las dos había dado la cara porque **nadie asignaba el estado**: las 26
// apariciones de `moroso` en el código eran lecturas. Latente, como la nota de crédito.
// ═══════════════════════════════════════════════════════════════════════════
describe('La mora se deriva de las facturas, no se almacena', () => {
  it('un comprobante vencido es exigible, con saldo, y pasado su día de pago', () => {
    const sql = SQL_COMPROBANTE_VENCIDO('f');

    // Exigible: emitido, no saldado, y CARGO — una nota de crédito no es deuda (A-5).
    expect(sql).toContain(`f.estado IN ('emitida', 'pagada_parcial', 'vencida', 'en_cobranza')`);
    expect(sql).toContain('f.factura_original_id IS NULL');
    expect(sql).toContain('COALESCE(f.saldo, f.total - f.monto_pagado) > 0');

    // Desde el día SIGUIENTE al día de pago: los días de gracia son la distancia hasta el
    // corte, no hasta el vencimiento. Meterlos aquí retrasaría la etiqueta y, peor, el
    // recuento del corte por acumulación, que usa esta misma condición.
    expect(sql).toContain('f.fecha_vencimiento < CURRENT_DATE');
    expect(sql).not.toContain('dias_gracia');
  });

  it('la etiqueta es por CLIENTE, porque el comprobante es consolidado', () => {
    const sql = sqlEnMora('co.cliente_id');
    expect(sql).toContain('EXISTS');
    expect(sql).toContain('fm.cliente_id = co.cliente_id');
    // Un abonado con dos servicios recibe un comprobante, con `contrato_id` en NULL:
    // preguntar por contrato dejaría fuera justo la deuda consolidada.
    expect(sql).not.toContain('contrato_id');
  });

  it('el historial distingue un descuido de un patrón', () => {
    const unDescuido = historialDesde({ comprobantes: 10, pagados_tarde: 1, vencidos_hoy: 0 });
    expect(unDescuido.recurrente).toBe(false);
    expect(unDescuido.tasaMora).toBe(0.1);

    const patron = historialDesde({ comprobantes: 10, pagados_tarde: 3, vencidos_hoy: 1 });
    expect(patron.recurrente).toBe(true);
    expect(patron.tasaMora).toBe(0.4);

    // Sin comprobantes vencidos no hay denominador: `0` afirmaría que nunca se atrasa, y
    // lo cierto es que todavía no se sabe.
    expect(historialDesde({ comprobantes: 0, pagados_tarde: 0, vencidos_hoy: 0 }).tasaMora).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// La barrera. El estado se BORRÓ; esto impide que vuelva por la puerta de atrás.
//
// Se comprobó contra producción antes de borrarlo: **cero contratos en `moroso` y cero
// registros entre las 44 filas de `contratos_historial`**. No es que estuviera en desuso —
// no ocurrió nunca, ni una vez, en toda la vida del sistema.
//
// El valor sigue en el tipo `estado_contrato` de PostgreSQL: quitarlo obliga a recrear el
// tipo con las tres columnas (`contratos.estado`, `contratos_historial.estado_anterior`,
// `estado_nuevo`) y la vista `v_contratos_completos` que dependen de él. Se hará en la
// instalación limpia, donde el tipo nace ya sin el valor. Hasta entonces, lo que importa es
// que **ningún literal `'moroso'` viva en el código** — que es de donde salieron los bugs.
// ═══════════════════════════════════════════════════════════════════════════
describe('El estado `moroso` no existe en el código', () => {
  const SRC = join(__dirname, '..', '..', '..');

  const ficherosTs = (dir: string): string[] => {
    const salida: string[] = [];
    for (const entrada of readdirSync(dir)) {
      if (entrada === 'node_modules' || entrada === 'dist' || entrada === 'migrations') continue;
      const ruta = join(dir, entrada);
      if (statSync(ruta).isDirectory()) { salida.push(...ficherosTs(ruta)); continue; }
      if (entrada.endsWith('.ts') && !entrada.endsWith('.spec.ts')) salida.push(ruta);
    }
    return salida;
  };

  const sinComentarios = (fuente: string): string =>
    fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('`EstadoContrato` ya no declara el valor', () => {
    const entidad = sinComentarios(readFileSync(
      join(SRC, 'modules', 'contratos', 'entities', 'contrato.entity.ts'), 'utf8',
    ));
    const enumerado = entidad.slice(
      entidad.indexOf('export enum EstadoContrato'),
      entidad.indexOf('}', entidad.indexOf('export enum EstadoContrato')),
    );

    expect(enumerado).not.toContain('MOROSO');
    // Los que sí existen, para que borrar de más también falle.
    for (const v of ['PENDIENTE_ACTIVACION', 'ACTIVO', 'SUSPENDIDO', 'CORTADO', 'BAJA_DEFINITIVA']) {
      expect(enumerado).toContain(v);
    }
  });

  /**
   * Ningún literal `'moroso'` en una lista de estados de contrato. Se excluye lo que se
   * llama igual sin serlo —el address-list `morosos_datafast` de MikroTik, el job
   * `detectar-morosos`, la clase CSS `badge-moroso`—, porque castigar el nombre en vez del
   * uso es el falso positivo que ya dieron la barrera del dinero (un comentario) y el
   * barrido de autorización (un comentario entre decoradores).
   */
  it("ninguna consulta ni lista compara un estado con 'moroso'", () => {
    const infractores: string[] = [];

    for (const ruta of ficherosTs(SRC)) {
      const rel = ruta.slice(SRC.length + 1).replace(/\\/g, '/');
      if (rel.includes('database/migrations/')) continue; // SQL ya aplicado: no cambia

      const texto = sinComentarios(readFileSync(ruta, 'utf8'));
      texto.split(/\r?\n/).forEach((linea, i) => {
        // El literal exacto, en singular y entrecomillado. `ADDRESS_LIST_MOROSOS` y
        // `'morosos_datafast'` no coinciden; `'moroso'` sí.
        if (/'moroso'/.test(linea)) infractores.push(`${rel}:${i + 1}`);
        if (/EstadoContrato\.MOROSO/.test(linea)) infractores.push(`${rel}:${i + 1}`);
      });
    }

    // Si esto falla: la mora volvió a ser un estado. No lo es — es una etiqueta derivada
    // (`mora.ts`). De aquí salieron los dos bugs: el reconciliador que lo leía como «sin
    // servicio» y el corte que habría dejado de ver a quien lo tuviera.
    expect(infractores).toEqual([]);
  });

  it('un abonado en mora conserva el servicio: ESTADOS_CORTADOS son dos', () => {
    const reconciliador = readFileSync(
      join(SRC, 'modules', 'mikrotik', 'services', 'address-list-reconciliador.service.ts'),
      'utf8',
    );
    const linea = sinComentarios(reconciliador)
      .split('\n').find((l) => l.includes('const ESTADOS_CORTADOS')) ?? '';

    expect(linea).toContain("'suspendido'");
    expect(linea).toContain("'cortado'");
    // El error que estuvo latente durante meses: contarlo entre los que NO tienen servicio.
    expect(linea).not.toContain("'moroso'");
  });
});
