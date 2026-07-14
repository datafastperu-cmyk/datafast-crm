import { MigrationInterface, QueryRunner } from 'typeorm';

// Incremento 7 — Ownership de recursos + unicidad de IP de gestión.
//
// 1. Dedupe de OLTs activas por (empresa_id, ip_gestion): la validación
//    _validarIpUnica es check-then-insert y permitió duplicados (caso real:
//    9 Huawei duplicadas creadas por el wizard). Se conserva por cada IP la
//    OLT con proveedor configurado (la operativa); a igualdad, la más
//    reciente. Las demás se desactivan (soft — no se borra nada).
// 2. Índice UNIQUE parcial que impide duplicados a nivel BD (cierra la
//    race condition de forma definitiva).
// 3. Corrección de ownership de VLANs: el default 'erp' de olt_vlans.origen
//    marcó como propias del ERP las VLANs descubiertas en la OLT por el
//    sync. A la fecha el ERP no ha creado ninguna VLAN propia en producción
//    (su primer recurso propio es la traffic table ERP-100M), así que todas
//    las filas existentes pasan a 'olt' y el default de la columna cambia a
//    'olt' (lo desconocido es externo; 'erp' se declara explícitamente).
export class OwnershipRecursosYUnicidadIpOlt1791700000014 implements MigrationInterface {
  name = 'OwnershipRecursosYUnicidadIpOlt1791700000014';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Desactivar duplicados: rank 1 = tiene proveedor activo, luego la más reciente.
    await queryRunner.query(`
      WITH ranked AS (
        SELECT o.id,
               ROW_NUMBER() OVER (
                 PARTITION BY o.empresa_id, o.ip_gestion
                 ORDER BY
                   (EXISTS (
                     SELECT 1 FROM olt_proveedor_config c
                     WHERE c.olt_id = o.id AND c.activo = TRUE
                   )) DESC,
                   o.created_at DESC
               ) AS rn
        FROM olt_dispositivos o
        WHERE o.activo = TRUE AND o.deleted_at IS NULL
      )
      UPDATE olt_dispositivos
      SET activo = FALSE, updated_at = NOW()
      WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
    `);

    // 2. Unicidad a nivel BD (solo entre OLTs activas no eliminadas).
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_olt_disp_empresa_ip_activa
        ON olt_dispositivos (empresa_id, ip_gestion)
        WHERE activo = TRUE AND deleted_at IS NULL;
    `);

    // 3. Ownership de VLANs: todo lo existente es externo; default pasa a 'olt'.
    await queryRunner.query(`UPDATE olt_vlans SET origen = 'olt' WHERE origen = 'erp';`);
    await queryRunner.query(`ALTER TABLE olt_vlans ALTER COLUMN origen SET DEFAULT 'olt';`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_olt_disp_empresa_ip_activa;`);
    await queryRunner.query(`ALTER TABLE olt_vlans ALTER COLUMN origen SET DEFAULT 'erp';`);
    // No se revierten ni la desactivación de duplicados ni el origen de las
    // VLANs: son correcciones de datos, no de esquema.
  }
}
