import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNoEnviadoToEstadoEntrega1783300000000 implements MigrationInterface {
  // ALTER TYPE … ADD VALUE no puede ejecutarse dentro de una transacción en PG < 12
  public readonly transaction = false;

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(
      `ALTER TYPE notificaciones_estado_entrega ADD VALUE IF NOT EXISTS 'NO_ENVIADO';`,
    );
  }

  async down(qr: QueryRunner): Promise<void> {
    // PostgreSQL no permite eliminar valores de un ENUM sin recrear el tipo.
  }
}
