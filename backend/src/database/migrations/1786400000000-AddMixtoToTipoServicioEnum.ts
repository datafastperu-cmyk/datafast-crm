import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMixtoToTipoServicioEnum1786400000000 implements MigrationInterface {
  name = 'AddMixtoToTipoServicioEnum1786400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ALTER TYPE ADD VALUE no puede ejecutarse dentro de una transacción
    // en PostgreSQL < 12. TypeORM por defecto envuelve en transacción,
    // pero el IF NOT EXISTS evita error si ya existe el valor.
    await queryRunner.query(`
      ALTER TYPE tipo_servicio ADD VALUE IF NOT EXISTS 'mixto'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL no permite eliminar valores de un enum.
    // El valor 'mixto' queda en el tipo pero sin uso si se revierte.
    // Para revertir completamente se necesitaría recrear el tipo —
    // operación demasiado destructiva para un down automático.
  }
}
