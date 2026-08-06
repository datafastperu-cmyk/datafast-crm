import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────────────────────
// F4 — Extorno de pagos.
//
// Un pago mal registrado, un cheque rebotado, una transferencia devuelta o un
// contracargo no tenían forma correcta de deshacerse: lo que había era `eliminar()`,
// que BORRABA la fila del pago y restaba a ojo sobre la factura.
//
// Borrar un pago es perder el único rastro de que ese dinero existió. Y restar en vez
// de recalcular hace que una reversión interrumpida y reintentada descuadre el saldo.
//
// Aquí:
//   · `extornado` como estado del pago — el pago no desaparece, se anula.
//   · `pago_extorno` con el motivo TIPIFICADO, quién lo hizo y qué valores tenía antes.
//     El motivo no es decorativo: decide si el dinero vuelve al abonado y si el corte
//     del servicio es legítimo o es un error nuestro.
//
// El valor del enum se añade en su propia sentencia y NO se usa en esta migración:
// Postgres permite `ALTER TYPE ... ADD VALUE` dentro de una transacción, pero no usar
// el valor recién creado en esa misma transacción.
// ─────────────────────────────────────────────────────────────────────────────
export class CreateExtornoPago1791800000041 implements MigrationInterface {
  name = 'CreateExtornoPago1791800000041';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TYPE estado_pago ADD VALUE IF NOT EXISTS 'extornado'`);

    await qr.query(`
      CREATE TABLE IF NOT EXISTS pago_extorno (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        pago_id     UUID NOT NULL REFERENCES pagos(id) ON DELETE RESTRICT,

        -- Tipificado, no texto libre: de esto depende si el dinero se le devuelve al
        -- abonado y si su servicio puede cortarse. 'error_registro' —el caso más
        -- frecuente— significa que la equivocación es NUESTRA.
        motivo      VARCHAR(30) NOT NULL,
        nota        TEXT,

        -- Lo que el pago tenía antes de anularse. Se guarda aquí porque la fila del pago
        -- sigue existiendo pero cambia de estado: sin esto, dentro de un año nadie puede
        -- reconstruir qué se deshizo exactamente.
        monto_revertido NUMERIC(12,2) NOT NULL,
        facturas_afectadas JSONB NOT NULL DEFAULT '[]'::jsonb,

        -- Si el pago ya estaba conciliado con el extracto bancario, el extorno rompe un
        -- cierre contable ya cerrado. Se registra para que salte en la revisión.
        estaba_conciliado BOOLEAN NOT NULL DEFAULT FALSE,

        usuario_id    UUID,
        usuario_email VARCHAR(200),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT ck_pago_extorno_motivo CHECK (motivo IN (
          'error_registro', 'devolucion_cliente', 'cheque_rebotado',
          'contracargo', 'pago_duplicado', 'fraude'
        ))
      )
    `);

    // Un pago se extorna UNA vez. Reintentar un extorno interrumpido no puede crear una
    // segunda fila ni revertir el dinero dos veces.
    await qr.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_pago_extorno_pago
        ON pago_extorno (pago_id)
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_pago_extorno_empresa_fecha
        ON pago_extorno (empresa_id, created_at DESC)
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS pago_extorno`);
    // El valor del enum NO se retira: si hay pagos extornados, quitarlo dejaría filas
    // apuntando a un valor inexistente. Un enum con un valor de más es inofensivo;
    // una fila con un estado que no existe, no.
  }
}
