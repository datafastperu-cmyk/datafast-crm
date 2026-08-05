import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────────────────────
// "Solo registrar": cobrar sin devolver el servicio.
//
// Caso que lo motiva: un abonado que se da de baja paga su ÚLTIMO comprobante. Con la
// reactivación automática —que salta siempre que un pago deja la deuda en cero— el ERP le
// devolvía el servicio a alguien que se está yendo, y seguía navegando hasta que alguien
// lo notara.
//
// La decisión se toma al REGISTRAR el pago, pero la reactivación puede ocurrir mucho
// después (cuando un supervisor verifica un pago pendiente). Por eso viaja en la fila del
// pago y no en una variable del momento: quien verifica días más tarde tiene que saber qué
// se decidió en el mostrador.
//
// Default TRUE: el comportamiento normal es reactivar. Solo el operador que elige "Solo
// registrar" lo desactiva, y queda en auditoría.
// ─────────────────────────────────────────────────────────────────────────────
export class AddReactivarServicioAPagos1791800000037 implements MigrationInterface {
  name = 'AddReactivarServicioAPagos1791800000037';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE pagos
        ADD COLUMN IF NOT EXISTS reactivar_servicio BOOLEAN NOT NULL DEFAULT TRUE
    `);
    await qr.query(`
      COMMENT ON COLUMN pagos.reactivar_servicio IS
        'FALSE = cobrar sin reactivar el servicio (baja voluntaria que salda su último comprobante)'
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE pagos DROP COLUMN IF EXISTS reactivar_servicio`);
  }
}
