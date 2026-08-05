import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────────────────────
// Devolución de un adelanto.
//
// Un adelanto es dinero del abonado que todavía no se ha imputado a ningún comprobante,
// así que tiene que poder devolverse. Rechazar un pago (`motivo_rechazo`) es otra cosa:
// significa que el cobro nunca fue válido. Devolver significa que fue válido, entró en
// caja y sale de ella — y el arqueo tiene que poder distinguirlos.
//
// El estado `devuelto` ya existía en el enum `estado_pago` sin que nadie lo usara; estas
// columnas son las que hacen que devolver deje rastro de quién, cuándo y por qué.
// ─────────────────────────────────────────────────────────────────────────────
export class AddDevolucionAdelanto1791800000036 implements MigrationInterface {
  name = 'AddDevolucionAdelanto1791800000036';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE pagos
        ADD COLUMN IF NOT EXISTS devuelto_en        TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS devuelto_por       UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS motivo_devolucion  TEXT
    `);

    // Los adelantos son los pagos sin comprobante imputado. Se consultan por cliente en la
    // pestaña Saldos y en /finanzas/adelanto-prorroga, así que el índice cubre ese acceso.
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_pagos_adelantos
        ON pagos (empresa_id, cliente_id)
        WHERE factura_id IS NULL
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_pagos_adelantos`);
    await qr.query(`
      ALTER TABLE pagos
        DROP COLUMN IF EXISTS devuelto_en,
        DROP COLUMN IF EXISTS devuelto_por,
        DROP COLUMN IF EXISTS motivo_devolucion
    `);
  }
}
