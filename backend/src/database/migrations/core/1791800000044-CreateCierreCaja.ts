import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────────────────────
// F6 — Arqueo y cierre de caja.
//
// Con cuentas receptoras de tipo `caja` el negocio necesita cuadrar: cuánto dice el ERP
// que entró en esa caja, cuánto hay físicamente, y la diferencia.
//
// **La diferencia se DECLARA, no se oculta.** Una caja que cuadra siempre no es una caja
// que cuadra: es una caja donde el descuadre se absorbe en silencio. Registrar la
// diferencia con nombre y fecha es lo que convierte el arqueo en un control y no en un
// trámite.
//
// `esperado` se guarda además de calcularse: es una foto del momento del cierre. Si un
// pago se extorna después, el cálculo de hoy ya no daría lo mismo, y el arqueo dejaría de
// poder auditarse.
// ─────────────────────────────────────────────────────────────────────────────
export class CreateCierreCaja1791800000044 implements MigrationInterface {
  name = 'CreateCierreCaja1791800000044';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS cierre_caja (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        cuenta_id   UUID NOT NULL REFERENCES cuentas_bancarias(id) ON DELETE RESTRICT,

        desde  DATE NOT NULL,
        hasta  DATE NOT NULL,

        -- Foto del momento: lo que el ERP decía que había cuando se cerró.
        esperado   NUMERIC(12,2) NOT NULL,
        -- Lo que se contó de verdad.
        contado    NUMERIC(12,2) NOT NULL,
        -- Derivada y persistida: es el dato que se audita.
        diferencia NUMERIC(12,2) NOT NULL,

        -- Obligatoria cuando hay descuadre: un faltante sin explicación es justo lo que
        -- el arqueo existe para detectar.
        nota       TEXT,

        usuario_id    UUID,
        usuario_email VARCHAR(200),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT ck_cierre_caja_periodo CHECK (hasta >= desde)
      )
    `);

    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_cierre_caja_cuenta_fecha
        ON cierre_caja (empresa_id, cuenta_id, hasta DESC)
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS cierre_caja`);
  }
}
