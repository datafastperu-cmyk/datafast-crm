import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 4.1 del plan del core — **`facturas` y el historial nombran el servicio, no el contrato**.
 *
 * Es el trozo de 3c que la fase 4 sí reclama. El resto —`pagos`, `cargos_pendientes`,
 * `promesas_pago`— sigue aplazado: son 374 sitios y nadie los pide todavía.
 *
 * Por qué esta parte sí. La fase 4 baja la configuración de facturación al contrato, así que la
 * generación pasa a agrupar **por contrato** y la factura tiene que registrar a qué acuerdo
 * pertenece. Para que `facturas.contrato_id` pueda significar «acuerdo», antes tiene que dejar de
 * significar «servicio».
 *
 * **Se renombra ahora y se añade después**, igual que en 3a. Si se hicieran a la vez, cada
 * consulta no barrida seguiría compilando y leyendo `contrato_id` —solo que un valor con otro
 * significado— y devolvería resultados plausibles y equivocados. Dejando el nombre libre, un
 * descuido falla con «column does not exist».
 *
 * `servicios_historial.contrato_id` entra en el mismo viaje: desde 3a apunta a `servicios`, así
 * que su nombre lleva un día mintiendo.
 */
export class FacturaApuntaAlServicio1791800000055 implements MigrationInterface {
  name = 'FacturaApuntaAlServicio1791800000055';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE facturas            RENAME COLUMN contrato_id TO servicio_id`);
    await q.query(`ALTER TABLE servicios_historial RENAME COLUMN contrato_id TO servicio_id`);

    // Los índices no siguen a la columna en su nombre. Lo aprendimos en 3b, cuando uno heredado
    // colisionó y tumbó la migración entera: se renombran en bucle porque la lista depende del
    // histórico de cada instalación.
    await q.query(`
      DO $$
      DECLARE r RECORD; nuevo TEXT;
      BEGIN
        FOR r IN SELECT indexname FROM pg_indexes
                  WHERE tablename IN ('facturas', 'servicios_historial')
                    AND indexname LIKE '%contrato%'
        LOOP
          nuevo := replace(r.indexname, 'contrato', 'servicio');
          IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = nuevo) THEN
            EXECUTE format('ALTER INDEX %I RENAME TO %I', r.indexname, nuevo);
          END IF;
        END LOOP;
      END $$;
    `);

    await q.query(`
      COMMENT ON COLUMN facturas.servicio_id IS
        'Servicio concreto que motivo el comprobante, o NULL si es consolidado. El ACUERDO al que '
        'pertenece la factura llega en la fase 4.2, en una columna propia.'
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE servicios_historial RENAME COLUMN servicio_id TO contrato_id`);
    await q.query(`ALTER TABLE facturas            RENAME COLUMN servicio_id TO contrato_id`);
  }
}
