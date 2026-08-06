import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────────────────────
// F5 — Clave de idempotencia por request. Cierra el hueco del efectivo.
//
// La idempotencia del módulo se apoyaba en `numero_operacion`, y funciona bien para
// transferencias, billeteras y pasarelas. Pero **un cobro en efectivo no tiene número de
// operación**: nada impedía que un doble clic, un reintento del navegador o una red lenta
// generaran dos filas de S/ 85 para el mismo abonado.
//
// El diagnóstico F0 comprobó que hoy no hay duplicados — con dos pagos en la base es
// difícil que los haya. El agujero se cierra ahora porque se vuelve probable exactamente
// cuando empieza la caja real con volumen, que es cuando ya no se puede corregir sin
// devolverle dinero a alguien.
//
// La clave la genera el CLIENTE (una por apertura del formulario) y viaja en cada intento.
// Un segundo envío con la misma clave no es un error del cajero: es un fallo de la red o
// del ratón, así que devuelve el pago que ya existe en vez de un rechazo.
//
// Es una columna, no una tabla: la idempotencia tiene que ser PERSISTENTE. Guardarla en
// memoria o en caché la haría desaparecer justo en el reinicio o la restauración de
// backup, que son los momentos en que los reintentos se acumulan.
// ─────────────────────────────────────────────────────────────────────────────
export class AddIdempotencyKeyAPagos1791800000043 implements MigrationInterface {
  name = 'AddIdempotencyKeyAPagos1791800000043';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE pagos ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(64)
    `);

    // Parcial: el histórico y los pagos que no la envíen quedan fuera, y varios NULL no
    // colisionan en un índice único de Postgres.
    await qr.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_pagos_empresa_idempotency
        ON pagos (empresa_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS uq_pagos_empresa_idempotency`);
    await qr.query(`ALTER TABLE pagos DROP COLUMN IF EXISTS idempotency_key`);
  }
}
