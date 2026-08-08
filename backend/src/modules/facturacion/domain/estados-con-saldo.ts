import { EstadoFactura } from '../entities/factura.entity';

// ═══════════════════════════════════════════════════════════════════════════
// Qué estados de factura representan dinero que el cliente TODAVÍA debe.
//
// Definición única. Antes estaba escrita a mano en más de quince consultas, y no todas
// decían lo mismo — que es la forma en que un criterio disperso deja de ser un criterio:
//
//   `cobranza.worker` (CORTA EL SERVICIO)  → emitida, pagada_parcial, vencida, en_cobranza
//   `v_resumen_financiero` (vista de BD)   → emitida, pagada_parcial, vencida
//   `sistema.service`                      → emitida, pagada_parcial, vencida
//   `factura.repository` (varias)          → emitida, pagada_parcial
//
// Una factura en `en_cobranza` era deuda para quien decide cortar el servicio y no lo era
// para el resumen financiero. No fallaba nada: el ERP simplemente respondía distinto según
// por dónde se le preguntara, que es peor, porque nadie lo nota (desviación A-4).
//
// LA REGLA: debe todo lo que está emitido y no está saldado. `borrador` aún no existe para
// el cliente, `pagada` ya no debe nada y `anulada` dejó de deber. Todo lo demás, sí — y
// `en_cobranza` especialmente: que una deuda esté en gestión de cobro no la extingue.
//
// El saldo de CADA factura no se calcula aquí: `facturas.saldo` es
// `GENERATED ALWAYS AS (total - monto_pagado) STORED`, lo mantiene PostgreSQL y ningún
// escritor puede saltárselo. Lo que este fichero define es la AGREGACIÓN: qué facturas
// entran en la suma.
// ═══════════════════════════════════════════════════════════════════════════
export const ESTADOS_CON_SALDO: readonly EstadoFactura[] = [
  EstadoFactura.EMITIDA,
  EstadoFactura.PAGADA_PARCIAL,
  EstadoFactura.VENCIDA,
  EstadoFactura.EN_COBRANZA,
] as const;

/**
 * Lista SQL lista para interpolar: `('emitida', 'pagada_parcial', 'vencida', 'en_cobranza')`.
 *
 * Se interpola en vez de pasarse como parámetro porque muchas de estas consultas son
 * literales grandes con `IN ${...}` y convertirlas todas a `= ANY($n)` renumeraría sus
 * parámetros posicionales — un cambio mecánico y silencioso justo en el código que decide
 * cortes de servicio. **No hay riesgo de inyección: el contenido sale del enum, no de una
 * entrada.** Lo sostiene un test que comprueba que ningún valor trae comillas.
 */
export const SQL_ESTADOS_CON_SALDO: string =
  `(${ESTADOS_CON_SALDO.map((e) => `'${e}'`).join(', ')})`;

/**
 * Igual, pero cualificando la columna: `f.estado IN (...)`.
 * Ahorra el error de olvidar el alias en una consulta con JOIN.
 */
export const sqlEstadoConSaldo = (alias?: string): string =>
  `${alias ? `${alias}.` : ''}estado IN ${SQL_ESTADOS_CON_SALDO}`;
