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
 *
 * **No se exporta a propósito.** El estado por sí solo NO define la deuda: ver abajo.
 */
const SQL_ESTADOS_CON_SALDO: string =
  `(${ESTADOS_CON_SALDO.map((e) => `'${e}'`).join(', ')})`;

// ═══════════════════════════════════════════════════════════════════════════
// El estado NO basta: una NOTA DE CRÉDITO también está `emitida` (hallazgo 2026-08-08)
//
// `crearNotaCredito` emite el abono como una fila más de `facturas`: estado `emitida`,
// `total` POSITIVO —lo impide ser negativo el CHECK `facturas_total_check (total >= 0)`—,
// `monto_pagado = 0` y `contrato_id` heredado del original. Como `saldo` es
// `GENERATED ALWAYS AS (total - monto_pagado)`, el abono nace con saldo positivo.
//
// Ninguno de los nueve consumidores de la deuda distinguía el documento, así que anular
// una factura de S/ 50 no bajaba la deuda: la original salía (pasa a `anulada`) y su nota
// de crédito entraba por el mismo importe. El abono se contaba como cargo.
//
// Y no se quedaba ahí. La nota nace con `fecha_vencimiento` = hoy, así que al día
// siguiente el barrido `MARCAR_FACTURAS_VENCIDAS` la pasa a `vencida`; desde ahí:
//
//   · suma un comprobante más a `meses_deuda`, que es lo que alimenta el corte por
//     meses acumulados (`aplicarCorte`) → anular una factura podía CORTAR al abonado;
//   · `pagos.service` exige `deuda <= 0` para reactivar tras el cobro → el abonado paga
//     todo y no se le reactiva nunca, porque le queda debiendo su propia nota de crédito;
//   · la cobranza le reclama el pago del abono que se le acaba de conceder.
//
// Verificado en producción el 2026-08-08: **0 notas de crédito y 0 facturas anuladas**.
// El defecto estaba LATENTE — se dispara la primera vez que un operador anule algo, que
// es justo lo que va a pasar en la beta.
//
// Odoo y ERPNext resuelven esto haciendo el abono NEGATIVO (asiento de reversión / factura
// con `is_return` y cantidades en negativo), y por eso resta solo. Aquí el CHECK lo impide,
// así que se distingue por documento. Cuál de los dos modelos adoptar es decisión del ADR
// de benchmark; que un abono no cuente como cargo no depende del modelo que se elija.
//
// EL DISCRIMINANTE es `factura_original_id`: solo lo lleva un documento que rectifica a
// otro, y es una FK real, no un prefijo de cadena que alguien pueda reproducir sin querer.
// **Si algún día se emiten NOTAS DE DÉBITO** —que rectifican al alza y SÍ son cargo—
// llevarán también `factura_original_id` y este predicado dejará de servir: hará falta
// entonces una clase de documento explícita (`cargo` | `abono`).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Predicado completo de «esta fila es dinero que el cliente todavía debe».
 *
 * Es lo único que se exporta para SQL: el estado suelto se dejó privado para que no se
 * pueda volver a preguntar por la deuda olvidando el tipo de documento.
 *
 * @param alias alias de la tabla en la consulta (`'f'` → `f.estado …`). Sin alias en
 *              consultas de una sola tabla.
 */
export const sqlDeudaExigible = (alias?: string): string => {
  const p = alias ? `${alias}.` : '';
  return `${p}estado IN ${SQL_ESTADOS_CON_SALDO} AND ${p}factura_original_id IS NULL`;
};
