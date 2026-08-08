import { sqlDeudaExigible } from './estados-con-saldo';

// ═══════════════════════════════════════════════════════════════════════════
// LA MORA ES UNA ETIQUETA, NO UN ESTADO
//
// Decisión del propietario, 2026-08-08: *«que `moroso` no sea un estado, sea una etiqueta
// para el análisis estadístico»*. Antes había pedido que fuera un estado del contrato; al
// medir el radio de ese cambio —`estado = 'activo'` aparece en 57 consultas— cambió el
// diseño, y el nuevo es mejor por tres razones que conviene dejar escritas:
//
// 1. **No se puede desincronizar.** Un estado almacenado es una segunda verdad que hay que
//    acordarse de mantener; una etiqueta derivada de las facturas ES la verdad, siempre.
//    Es la misma lección de A-4 (la deuda en cuatro sitios) y del latido derivado del
//    `SchedulerRegistry`: lo que se deriva no se olvida.
// 2. **No cambia el comportamiento operativo.** Escribir `estado = 'moroso'` habría hecho
//    que el abonado desapareciera de las 57 consultas que filtran por `'activo'`. La peor:
//    `cobranza.worker.detectarMorosos` filtra por `'activo'`, así que el estado creado para
//    MEDIR la morosidad habría impedido cortar a los morosos.
// 3. **Da historia gratis.** Un estado dice cómo está hoy. Las facturas dicen cómo estuvo
//    siempre, y eso es justo lo que el propietario quiere saber: *«qué probabilidad tiene
//    el cliente de pasar a moroso, ¿es un moroso recurrente?»*.
//
// `EstadoContrato.MOROSO` queda RETIRADO: no se puede entrar en él (ver `TRANSICIONES` en
// `contratos.service.ts`) y una barrera impide asignarlo. No se borra del enum porque el
// tipo existe en PostgreSQL y 26 consultas lo nombran; borrarlo sería una migración
// irreversible a cambio de nada.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Un comprobante que **hoy** cuenta como vencido e impago.
 *
 * Tres condiciones, y las tres importan:
 *   · `sqlDeudaExigible` — está emitido, no saldado, y es un CARGO (una nota de crédito no
 *     es deuda: A-5).
 *   · saldo positivo — un abono parcial que lo dejó en cero no vence nada.
 *   · `fecha_vencimiento < CURRENT_DATE` — **desde el día siguiente al día de pago**. Los
 *     días de gracia NO entran en esta cuenta: son la distancia hasta el corte, no hasta el
 *     vencimiento (regla del propietario, 2026-08-08).
 *
 * Es la misma condición que usa el corte por acumulación, y por eso vive aquí: el corte
 * cuenta cuántos hay y cuántos días lleva el último; la etiqueta solo pregunta si hay al
 * menos uno. Dos preguntas distintas sobre **un solo criterio**.
 */
export const SQL_COMPROBANTE_VENCIDO = (alias?: string): string => {
  const p = alias ? `${alias}.` : '';
  return `${sqlDeudaExigible(alias)}
           AND COALESCE(${p}saldo, ${p}total - ${p}monto_pagado) > 0
           AND ${p}fecha_vencimiento < CURRENT_DATE`;
};

/**
 * La etiqueta: **este abonado está en mora hoy**. Un `EXISTS` correlacionado por cliente.
 *
 * Se etiqueta por CLIENTE y no por contrato porque el comprobante es consolidado —un
 * abonado con dos servicios recibe uno solo, con `contrato_id` en NULL—, así que la mora es
 * una propiedad de quien debe, no de cada servicio.
 *
 * @param aliasCliente columna con el id del cliente en la consulta que lo invoca
 *                     (`'cl.id'`, `'co.cliente_id'`…).
 */
export const sqlEnMora = (aliasCliente: string): string => `EXISTS (
  SELECT 1 FROM facturas fm
   WHERE fm.cliente_id = ${aliasCliente}
     AND fm.deleted_at IS NULL
     AND ${SQL_COMPROBANTE_VENCIDO('fm')}
)`;

/**
 * El historial, para las dos preguntas del propietario. **Sin tabla nueva**: sale de las
 * propias facturas, que ya guardan `fecha_vencimiento` y `fecha_pago` desde el principio.
 *
 * Construir una tabla de instantáneas diarias habría dado lo mismo empezando desde hoy,
 * con una política de retención que mantener (C-7) y una fuente más que puede divergir.
 *
 * - `comprobantes` — total emitidos y ya vencidos: el denominador.
 * - `pagados_tarde` — los que se saldaron **después** de su vencimiento.
 * - `vencidos_hoy` — los que siguen impagos.
 * - `tasa_mora` — `(pagados_tarde + vencidos_hoy) / comprobantes`. Es la respuesta a
 *   «¿qué probabilidad tiene de pasar a moroso?» con su propia historia, no con un modelo.
 * - `recurrente` — más de un episodio de mora. Uno puede ser un descuido; dos son un
 *   patrón, y esa es la distinción que pide el propietario.
 */
export const SQL_HISTORIAL_MORA = `
  SELECT
    f.cliente_id,
    COUNT(*) FILTER (
      WHERE f.fecha_vencimiento < CURRENT_DATE
    )::int AS comprobantes,
    COUNT(*) FILTER (
      WHERE f.fecha_pago IS NOT NULL AND f.fecha_pago > f.fecha_vencimiento
    )::int AS pagados_tarde,
    COUNT(*) FILTER (
      WHERE f.fecha_pago IS NULL AND f.fecha_vencimiento < CURRENT_DATE
        AND COALESCE(f.saldo, f.total - f.monto_pagado) > 0
    )::int AS vencidos_hoy
  FROM facturas f
  WHERE f.deleted_at IS NULL
    AND f.factura_original_id IS NULL
    AND f.estado <> 'anulada'
    AND f.cliente_id = ANY($1)
  GROUP BY f.cliente_id
`;

/** Episodios de mora de un abonado y su tasa. `null` cuando aún no tiene historia. */
export interface HistorialMora {
  comprobantes: number;
  pagadosTarde: number;
  vencidosHoy: number;
  /** Fracción de comprobantes que llegaron a estar vencidos. `null` sin denominador. */
  tasaMora: number | null;
  /** Más de un episodio: un descuido no es un patrón. */
  recurrente: boolean;
}

/** Deriva las métricas de una fila de `SQL_HISTORIAL_MORA`. */
export const historialDesde = (fila: {
  comprobantes: number; pagados_tarde: number; vencidos_hoy: number;
}): HistorialMora => {
  const episodios = fila.pagados_tarde + fila.vencidos_hoy;
  return {
    comprobantes: fila.comprobantes,
    pagadosTarde: fila.pagados_tarde,
    vencidosHoy:  fila.vencidos_hoy,
    tasaMora:     fila.comprobantes > 0
      ? Math.round((episodios / fila.comprobantes) * 10000) / 10000
      : null,
    recurrente:   episodios > 1,
  };
};
