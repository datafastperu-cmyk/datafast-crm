import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ola 2 — quinto renombrado real (clasificación aprobada,
 * E-0.2-clasificacion-contrato-id.md v2). `pe_acometida.contrato_id` apunta hoy a
 * `servicios` — mismo origen que las tablas ya renombradas (censo E-0.2 §3.1).
 *
 * TÉCNICA: el cable físico de última milla de UNA conexión (planta externa), no el
 * acuerdo comercial.
 *
 * Índice a renombrar: `uq_pe_acometida_contrato` — es la garantía REAL de "un puerto, un
 * servicio" (el UPDATE condicional de `planta-externa-puertos.service.ts` es la primera
 * defensa; este índice único es la que no depende de que ese UPDATE siga bien escrito).
 * `uq_pe_acometida_puerto` no lleva "contrato" y no se toca.
 */
export class PeAcometidaApuntaAlServicio1791800000062 implements MigrationInterface {
  name = 'PeAcometidaApuntaAlServicio1791800000062';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE pe_acometida RENAME COLUMN contrato_id TO servicio_id`);
    await q.query(`ALTER INDEX uq_pe_acometida_contrato RENAME TO uq_pe_acometida_servicio`);

    await q.query(`
      COMMENT ON COLUMN pe_acometida.servicio_id IS
        'El Servicio Contratado (tabla servicios) al que llega esta acometida -- nunca el '
        'acuerdo. Se llamaba contrato_id, heredado del nombre de la tabla antes de la '
        'fase 3a (2026-08-09).'
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER INDEX uq_pe_acometida_servicio RENAME TO uq_pe_acometida_contrato`);
    await q.query(`ALTER TABLE pe_acometida RENAME COLUMN servicio_id TO contrato_id`);
  }
}
