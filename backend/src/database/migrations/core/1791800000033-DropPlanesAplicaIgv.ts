import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Elimina `planes.aplica_igv`.
 *
 * El IGV es propiedad del DOCUMENTO, no del producto: lo decide
 * `comprobantes_config.tiene_carga_fiscal` del comprobante asignado al cliente. Esta
 * bandera del plan competía con esa regla y ganaba a veces — bastaba un plan con
 * `aplica_igv = false` para emitir una factura fiscal sin IGV, o al revés, según qué plan
 * hubiera contratado el cliente (incidente 2026-08-04).
 *
 * Ya sin consumidores: el cálculo en `facturacion.service` y en `facturacion.worker` usa
 * la carga fiscal del comprobante, y la columna salió de la entidad, del DTO, de las dos
 * consultas que la seleccionaban y de la UI de planes (donde solo pintaba un «+ IGV» junto
 * al precio, sin control que lo editara).
 *
 * Se conserva el valor en `down()` con el default original para poder revertir el esquema;
 * los valores individuales por plan NO se recuperan, y no hace falta: nada los leía.
 */
export class DropPlanesAplicaIgv1791800000033 implements MigrationInterface {
  name = 'DropPlanesAplicaIgv1791800000033';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE planes DROP COLUMN IF EXISTS aplica_igv
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE planes ADD COLUMN IF NOT EXISTS aplica_igv BOOLEAN NOT NULL DEFAULT TRUE
    `);
  }
}
