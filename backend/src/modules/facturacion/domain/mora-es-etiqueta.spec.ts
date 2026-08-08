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
// La barrera. El estado quedó retirado; esto impide que vuelva por la puerta de atrás.
// ═══════════════════════════════════════════════════════════════════════════
describe('`EstadoContrato.MOROSO` está retirado: se sale, no se entra', () => {
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

  /**
   * `estado: EstadoContrato.MOROSO` aparece tanto en una ESCRITURA como en el `where` de
   * una consulta, y la diferencia importa: `pagos.service` **debe** poder buscar contratos
   * en `moroso` para reactivar los que una instalación antigua dejó ahí. Distinguirlas por
   * la forma del literal marcó ese `where` como infractor en la primera versión de este
   * test — el mismo falso positivo que ya dieron la barrera del dinero (un comentario) y
   * el barrido de autorización (un comentario entre decoradores).
   *
   * Se mira el contexto anterior: si hay un `where`/`find`/`In(` cerca, es una lectura.
   * **Límite conocido:** una escritura escrita a más de 300 caracteres de su contexto se
   * escaparía. La garantía fuerte no está aquí, sino en la tabla de transiciones —
   * `cambiarEstado` es la puerta guardada— y este test es la red que cubre los atajos.
   */
  const esLectura = (texto: string, posicion: number): boolean =>
    /\b(where|find|findOne|In\()\b/i.test(texto.slice(Math.max(0, posicion - 300), posicion));

  it('nadie asigna el estado `moroso` (buscarlo sí está permitido)', () => {
    const infractores: string[] = [];

    for (const ruta of ficherosTs(SRC)) {
      const rel = ruta.slice(SRC.length + 1).replace(/\\/g, '/');
      const texto = sinComentarios(readFileSync(ruta, 'utf8'));

      for (const m of texto.matchAll(/estado\s*:\s*EstadoContrato\.MOROSO/g)) {
        if (!esLectura(texto, m.index ?? 0)) infractores.push(`${rel} (objeto)`);
      }
      if (/SET\s+estado\s*=\s*'moroso'/i.test(texto)) infractores.push(`${rel} (UPDATE)`);
    }

    // Si esto falla: la mora volvió a ser un estado. No lo es — es una etiqueta derivada
    // (`mora.ts`). Escribirla sacaría al abonado de las 57 consultas que filtran por
    // `'activo'`, incluida la que decide el corte.
    expect(infractores).toEqual([]);
  });

  it('la tabla de transiciones no ofrece ninguna ENTRADA a `moroso`', () => {
    const servicio = readFileSync(
      join(SRC, 'modules', 'contratos', 'contratos.service.ts'), 'utf8',
    );
    const tabla = servicio.slice(
      servicio.indexOf('const TRANSICIONES'),
      servicio.indexOf('};', servicio.indexOf('const TRANSICIONES')),
    );

    for (const origen of ['PENDIENTE_ACTIVACION', 'ACTIVO', 'SUSPENDIDO', 'CORTADO']) {
      const fila = tabla.split('\n').find((l) => l.includes(`[EstadoContrato.${origen}]:`)) ?? '';
      expect(fila).not.toContain('EstadoContrato.MOROSO');
    }

    // Las SALIDAS se conservan: el valor sigue en el enum de PostgreSQL y una instalación
    // antigua puede tener contratos ahí. Hay que poder sacarlos.
    const salidas = tabla.split('\n').find((l) => l.includes('[EstadoContrato.MOROSO]:')) ?? '';
    expect(salidas).toContain('EstadoContrato.ACTIVO');
  });

  it('un abonado en mora conserva el servicio: `moroso` no está en ESTADOS_CORTADOS', () => {
    const reconciliador = readFileSync(
      join(SRC, 'modules', 'mikrotik', 'services', 'address-list-reconciliador.service.ts'),
      'utf8',
    );
    const linea = sinComentarios(reconciliador)
      .split('\n').find((l) => l.includes('const ESTADOS_CORTADOS')) ?? '';

    expect(linea).toContain("'suspendido'");
    expect(linea).toContain("'cortado'");
    // El error que estuvo latente: leerlo como "sin servicio", al revés del enum.
    expect(linea).not.toContain("'moroso'");
  });
});
