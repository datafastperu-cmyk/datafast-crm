import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Imputa a cada contrato la parte de deuda que le corresponde.
 *
 * El comprobante es CONSOLIDADO por cliente: un abonado con dos servicios recibe uno
 * solo, con `contrato_id` en null. Eso es diseño —y es lo que hace cualquier operador—,
 * pero deja `contratos.deuda_total` sin nadie que lo actualice. Consecuencias reales,
 * observadas en producción:
 *
 *   · El portal mostraba "Deuda actual S/ 0.00" a un abonado que debía S/ 64.
 *   · El corte automático por morosidad decide POR CONTRATO. Sin imputación no sabe a
 *     qué servicio aplicar: o corta los dos o ninguno.
 *   · Un pago parcial no se puede asignar a un servicio concreto.
 *
 * FUENTE DE VERDAD: las FACTURAS. `contratos.deuda_total` pasa a ser una proyección que
 * se recalcula desde ellas, nunca un valor que se edita por su cuenta. Es la única
 * decisión defendible: la factura es el documento, el campo es una caché. Cuando dos
 * cifras pueden contradecirse, manda la que tiene respaldo documental.
 *
 * REPARTO de una factura consolidada: proporcional al peso de las líneas de cada
 * contrato sobre el total facturado. Si el abonado paga la mitad, cada servicio queda a
 * la mitad — no se puede saber "cuál" pagó, y suponerlo sería inventar.
 */
@Injectable()
export class DeudaPorContratoService {
  private readonly logger = new Logger(DeudaPorContratoService.name);

  // Estados que representan dinero que el cliente todavía debe.
  private static readonly ESTADOS_CON_SALDO =
    `('emitida', 'pagada_parcial', 'vencida', 'en_cobranza')`;

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /**
   * Recalcula `deuda_total` y `meses_deuda` de todos los contratos de un cliente.
   * Se invoca tras emitir una factura y tras registrar un pago.
   */
  async recalcularPorCliente(clienteId: string, empresaId: string): Promise<void> {
    try {
      const contratos = await this.ds.query<Array<{ id: string }>>(
        `SELECT id FROM contratos
          WHERE cliente_id = $1 AND empresa_id = $2 AND deleted_at IS NULL`,
        [clienteId, empresaId],
      );
      if (!contratos.length) return;

      const deudas = await this.calcular(clienteId, empresaId);

      // `fecha_ultimo_pago` es otra proyección del mismo tipo y se refresca aquí por la
      // misma razón: la ruta de cobro (`pagos.service`) no la escribía y solo el job
      // PROCESAR_PAGO —que esa ruta no usa— la tocaba, así que se quedaba en NULL aunque
      // el abonado hubiera pagado. El portal mostraba "sin pagos" y el corte automático
      // la leía como fecha de referencia de mora (incidente 2026-08-05).
      const [ultimo] = await this.ds.query<Array<{ fecha: string | null }>>(
        `SELECT MAX(fecha_pago) AS fecha FROM pagos
          WHERE cliente_id = $1 AND empresa_id = $2
            AND estado = 'verificado'`,
        [clienteId, empresaId],
      );

      for (const { id } of contratos) {
        const d = deudas.get(id) ?? { monto: 0, comprobantes: 0 };
        await this.ds.query(
          `UPDATE contratos
              SET deuda_total = $1,
                  meses_deuda = $2,
                  fecha_ultimo_pago = COALESCE($3::date, fecha_ultimo_pago)
            WHERE id = $4`,
          [d.monto, d.comprobantes, ultimo?.fecha ?? null, id],
        );
      }
    } catch (e) {
      // Nunca tumbar la emisión ni el cobro por no poder refrescar una proyección: el
      // dinero ya está registrado en la factura, que es la fuente. Se registra para que
      // el desajuste no pase inadvertido.
      this.logger.error(
        `No se pudo recalcular la deuda del cliente ${clienteId}: ` +
        `${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Deuda atribuible a cada contrato del cliente, calculada desde las facturas.
   * Público para que la cobranza y el portal puedan preguntar sin escribir nada.
   */
  async calcular(
    clienteId: string,
    empresaId: string,
  ): Promise<Map<string, { monto: number; comprobantes: number }>> {
    const filas = await this.ds.query<Array<{
      id: string; total: string; saldo: string | null; monto_pagado: string;
      contrato_id: string | null; items: unknown;
    }>>(
      `SELECT id, total, saldo, monto_pagado, contrato_id, items
         FROM facturas
        WHERE cliente_id = $1
          AND empresa_id = $2
          AND deleted_at IS NULL
          AND estado IN ${DeudaPorContratoService.ESTADOS_CON_SALDO}`,
      [clienteId, empresaId],
    );

    // Contratos con ciclo de vida vivo: los que pueden cargar con una deuda. Un contrato
    // dado de baja no debe recibir imputaciones nuevas.
    const contratosVivos = (await this.ds.query<Array<{ id: string }>>(
      `SELECT id FROM contratos
        WHERE cliente_id = $1 AND empresa_id = $2
          AND deleted_at IS NULL AND estado <> 'baja_definitiva'`,
      [clienteId, empresaId],
    )).map((c) => c.id);

    const deudas = new Map<string, { monto: number; comprobantes: number }>();
    const sumar = (contratoId: string, monto: number) => {
      if (monto <= 0) return;
      const actual = deudas.get(contratoId) ?? { monto: 0, comprobantes: 0 };
      actual.monto = Number((actual.monto + monto).toFixed(2));
      actual.comprobantes += 1;
      deudas.set(contratoId, actual);
    };

    for (const f of filas) {
      const total = Number(f.total);
      const saldo = f.saldo != null
        ? Number(f.saldo)
        : Number((total - Number(f.monto_pagado)).toFixed(2));
      if (saldo <= 0) continue;

      // Factura atada a un contrato (emisión manual): sin reparto que hacer.
      if (f.contrato_id) {
        sumar(f.contrato_id, saldo);
        continue;
      }

      const lineas = this.lineasPorContrato(f.items);

      // Consolidada sin líneas atribuibles: facturas emitidas antes de que el ítem
      // llevara `contratoId`, o compuestas solo de cargos.
      if (!lineas.size) {
        // Con UN solo contrato vivo no hay ambigüedad: esa deuda es suya y de nadie más.
        // Sin esto, la factura no se imputaba a ningún contrato y `deuda_total` mostraba
        // menos de lo que el cliente debía — el operador cobraba esa cifra y luego la
        // reactivación, que sí mira todas las facturas del cliente, se negaba a levantar
        // el servicio (incidente 2026-08-04, Piero Escobar: ERP decía S/64, debía S/128).
        if (contratosVivos.length === 1) {
          sumar(contratosVivos[0], saldo);
        }
        // Con varios contratos NO se reparte a ciegas: repartir a partes iguales
        // inventaría una imputación que nadie decidió. Queda como deuda del cliente sin
        // contrato — visible en su estado de cuenta, fuera del corte por contrato.
        continue;
      }

      const baseAtribuible = [...lineas.values()].reduce((s, v) => s + v, 0);
      if (baseAtribuible <= 0) continue;

      for (const [contratoId, importe] of lineas) {
        // Proporcional: si pagó la mitad de un consolidado, cada servicio queda a la
        // mitad. No hay forma de saber "cuál" pagó y suponerlo sería inventar.
        sumar(contratoId, Number((saldo * (importe / baseAtribuible)).toFixed(2)));
      }
    }

    return deudas;
  }

  /** Importe por contrato dentro de `items`. Tolera el jsonb suelto que puede venir. */
  private lineasPorContrato(items: unknown): Map<string, number> {
    const mapa = new Map<string, number>();
    if (!Array.isArray(items)) return mapa;

    for (const item of items) {
      const contratoId = (item as { contratoId?: unknown })?.contratoId;
      if (typeof contratoId !== 'string' || !contratoId) continue;

      const bruto = (item as { total?: unknown; subtotal?: unknown });
      const importe = Number(bruto.total ?? bruto.subtotal ?? 0);
      if (!Number.isFinite(importe) || importe <= 0) continue;

      mapa.set(contratoId, Number(((mapa.get(contratoId) ?? 0) + importe).toFixed(2)));
    }
    return mapa;
  }
}
