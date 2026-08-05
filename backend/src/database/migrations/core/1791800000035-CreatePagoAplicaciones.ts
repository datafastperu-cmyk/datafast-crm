import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────────────────────
// Pago consolidado: un pago puede saldar VARIOS comprobantes.
//
// Hasta ahora `pagos.factura_id` era una sola columna, así que cobrarle a un abonado
// con dos comprobantes exigía registrar dos pagos — y el operador tenía que repetir el
// mismo número de operación en ambos, cosa que el índice único de la tabla prohíbe.
// El cajero quedaba entre inventarse un código o no poder cobrar.
//
// Se modela como aplicación N:M (un pago, N facturas, con el importe imputado a cada
// una) en vez de permitir pagos que compartan número de operación. Así:
//
//   · El dinero entró UNA vez y hay UNA fila que lo representa. Es lo correcto
//     contablemente y lo que espera el arqueo de caja.
//   · La unicidad del número de operación se mantiene SIN excepciones. La alternativa
//     —N pagos con el mismo código— obligaba a relajar justo la regla que evita los
//     duplicados, y esa excepción es por donde se cuelan.
//
// La unicidad pasa además a ser por (empresa, número), sin el método de pago: un mismo
// código no se repite aunque uno sea Yape y otro transferencia.
// ─────────────────────────────────────────────────────────────────────────────
export class CreatePagoAplicaciones1791800000035 implements MigrationInterface {
  name = 'CreatePagoAplicaciones1791800000035';

  public async up(qr: QueryRunner): Promise<void> {

    await qr.query(`
      CREATE TABLE IF NOT EXISTS pago_aplicaciones (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id    UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        pago_id       UUID NOT NULL REFERENCES pagos(id)    ON DELETE CASCADE,
        factura_id    UUID NOT NULL REFERENCES facturas(id) ON DELETE RESTRICT,
        -- Lo que ESTE pago imputó a ESA factura. La suma de las aplicaciones de un pago
        -- es el monto del pago; la suma de las de una factura, su monto_pagado.
        monto_aplicado NUMERIC(12,2) NOT NULL CHECK (monto_aplicado > 0),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Un pago no puede imputarse dos veces a la misma factura: sería contarlo doble.
    await qr.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_pago_aplicaciones_pago_factura
        ON pago_aplicaciones (pago_id, factura_id)
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_pago_aplicaciones_factura
        ON pago_aplicaciones (factura_id)
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_pago_aplicaciones_empresa
        ON pago_aplicaciones (empresa_id)
    `);

    // ── Backfill: los pagos que ya existen conservan su imputación ──────────
    // Sin esto, el histórico quedaría sin aplicaciones y cualquier consulta nueva que
    // lea la tabla vería los cobros anteriores como no imputados.
    await qr.query(`
      INSERT INTO pago_aplicaciones (empresa_id, pago_id, factura_id, monto_aplicado, created_at)
      SELECT p.empresa_id, p.id, p.factura_id, p.monto, p.created_at
        FROM pagos p
       WHERE p.factura_id IS NOT NULL
         AND p.monto > 0
      ON CONFLICT (pago_id, factura_id) DO NOTHING
    `);

    // ── Unicidad del número de operación: por empresa, sin distinguir método ──
    // Los dos índices anteriores incluían `metodo_pago`, así que el mismo código pasaba
    // si cambiaba el método. Uno de ellos además NO tenía el WHERE ... IS NOT NULL; hoy
    // no rompe nada porque en Postgres varios NULL no colisionan en un índice único,
    // pero es una duplicación que confunde a quien lea el esquema.
    await qr.query(`DROP INDEX IF EXISTS "IDX_pagos_empresa_metodo_operacion"`);
    await qr.query(`
      ALTER TABLE pagos
        DROP CONSTRAINT IF EXISTS pagos_empresa_id_metodo_pago_numero_operacion_key
    `);
    await qr.query(`DROP INDEX IF EXISTS pagos_empresa_id_metodo_pago_numero_operacion_key`);

    // Se crea CONCURRENTLY no: la tabla es pequeña y la migración corre en despliegue.
    // Si hubiera duplicados previos la creación falla — y debe fallar: significa que ya
    // se cobró dos veces con el mismo código y eso lo tiene que revisar una persona.
    await qr.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_pagos_empresa_numero_operacion
        ON pagos (empresa_id, numero_operacion)
        WHERE numero_operacion IS NOT NULL
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS uq_pagos_empresa_numero_operacion`);
    await qr.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_pagos_empresa_metodo_operacion"
        ON pagos (empresa_id, metodo_pago, numero_operacion)
        WHERE numero_operacion IS NOT NULL
    `);
    await qr.query(`DROP TABLE IF EXISTS pago_aplicaciones`);
  }
}
