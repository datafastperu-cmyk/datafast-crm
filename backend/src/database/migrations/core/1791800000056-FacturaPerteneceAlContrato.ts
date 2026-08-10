import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 4.2a del plan del core — **la factura registra a qué ACUERDO pertenece**.
 *
 * En 4.1 se liberó el nombre: `facturas.contrato_id` pasó a `servicio_id`, que es lo que siempre
 * significó. Aquí vuelve `contrato_id`, ya con el sentido correcto — el acuerdo del que cuelga el
 * comprobante.
 *
 * Los dos conviven y no se pisan: **`servicio_id` dice qué servicio motivó la factura** (nulo en
 * las consolidadas, que es la mayoría) y **`contrato_id` dice de quién es la deuda**. Antes esa
 * segunda pregunta no tenía respuesta y había que deducirla del cliente, que es exactamente lo que
 * dejará de funcionar en cuanto un abonado tenga dos acuerdos — algo que el propietario señaló
 * como frecuente, no excepcional.
 *
 * **Aditiva a propósito: todavía no la lee nadie.** La generación sigue agrupando por cliente y la
 * configuración de facturación sigue en `clientes.facturacion_config`. Eso es 4.2b, y va aparte
 * porque sí cambia comportamiento.
 */
export class FacturaPerteneceAlContrato1791800000056 implements MigrationInterface {
  name = 'FacturaPerteneceAlContrato1791800000056';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE facturas
        ADD COLUMN contrato_id UUID REFERENCES contratos(id) ON DELETE RESTRICT
    `);

    // Camino 1: la factura nombra un servicio → el acuerdo es el de ese servicio. Es el más
    // fiable porque no supone nada.
    await q.query(`
      UPDATE facturas f
         SET contrato_id = s.contrato_id
        FROM servicios s
       WHERE s.id = f.servicio_id
         AND f.contrato_id IS NULL
    `);

    // Camino 2: consolidada (sin servicio) → el acuerdo del abonado. Hoy hay uno por cliente, así
    // que no hay ambigüedad; el día que haya dos, las facturas nuevas ya vendrán con el suyo
    // porque las emitirá la generación por contrato (4.2b). Este relleno es solo para lo ya emitido.
    await q.query(`
      UPDATE facturas f
         SET contrato_id = c.id
        FROM contratos c
       WHERE f.contrato_id IS NULL
         AND c.cliente_id = f.cliente_id
         AND c.empresa_id = f.empresa_id
         AND c.deleted_at IS NULL
    `);

    await q.query(`CREATE INDEX idx_facturas_contrato ON facturas (contrato_id)`);

    await q.query(`
      COMMENT ON COLUMN facturas.contrato_id IS
        'Acuerdo del que cuelga el comprobante: de quien es la deuda. Distinto de servicio_id, '
        'que dice que servicio la motivo y es nulo en las consolidadas.'
    `);

    // Se comprueba, no se confia. Una factura viva sin acuerdo seria deuda sin dueño en cuanto
    // 4.2b empiece a agrupar por contrato.
    const filas: Array<{ huerfanas: string }> = await q.query(`
      SELECT COUNT(*)::text AS huerfanas
        FROM facturas
       WHERE deleted_at IS NULL AND contrato_id IS NULL
    `);
    const huerfanas = Number(filas[0]?.huerfanas ?? 0);
    if (huerfanas > 0) {
      throw new Error(`Fase 4.2a: ${huerfanas} facturas vivas se quedaron sin contrato`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_facturas_contrato`);
    await q.query(`ALTER TABLE facturas DROP COLUMN IF EXISTS contrato_id`);
  }
}
