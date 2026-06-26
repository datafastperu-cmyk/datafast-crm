import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPermisoPagosAutoverificar1789200000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // Insertar el permiso
    await queryRunner.query(`
      INSERT INTO permisos (codigo, nombre, descripcion, modulo)
      VALUES (
        'pagos:autoverificar',
        'Auto-verificar pagos',
        'Permite registrar pagos que quedan verificados directamente sin aprobación manual',
        'pagos'
      )
      ON CONFLICT (codigo) DO NOTHING
    `);

    // Asignar a Supervisor (b0000000-0000-0000-0000-000000000002)
    await queryRunner.query(`
      INSERT INTO roles_permisos (rol_id, permiso_id)
      SELECT 'b0000000-0000-0000-0000-000000000002', id
      FROM permisos WHERE codigo = 'pagos:autoverificar'
      ON CONFLICT DO NOTHING
    `);

    // Asignar a Cajero (b0000000-0000-0000-0000-000000000003)
    await queryRunner.query(`
      INSERT INTO roles_permisos (rol_id, permiso_id)
      SELECT 'b0000000-0000-0000-0000-000000000003', id
      FROM permisos WHERE codigo = 'pagos:autoverificar'
      ON CONFLICT DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM roles_permisos
      WHERE permiso_id = (SELECT id FROM permisos WHERE codigo = 'pagos:autoverificar')
    `);
    await queryRunner.query(`
      DELETE FROM permisos WHERE codigo = 'pagos:autoverificar'
    `);
  }
}
