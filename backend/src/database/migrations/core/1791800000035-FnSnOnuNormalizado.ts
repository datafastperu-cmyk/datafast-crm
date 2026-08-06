import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Normalización del número de serie de una ONU.
 *
 * El MISMO equipo aparece en el ERP con dos codificaciones distintas, y por eso el estado
 * operativo que la OLT ya conoce no llegaba nunca al contrato:
 *
 *   ftth_onu_registro.sn    →  HWTC78CA0FAA        (prefijo ASCII del fabricante + hex)
 *   olt_onu_inventario.sn   →  4857544378CA0FAA    (hex puro, tal como lo reporta la OLT)
 *
 * No son seriales diferentes: `48 57 54 43` es exactamente "HWTC" en hexadecimal. El primero
 * es lo que viene impreso en la etiqueta de la ONU y lo que teclea el técnico; el segundo es
 * lo que devuelve `display ont info`. Ambos formatos son legítimos y ambos seguirán
 * entrando, así que la solución no es "arreglar los datos" —volverían a divergir con el
 * siguiente alta— sino tener UNA definición de cuándo dos seriales son el mismo equipo.
 *
 * Se elige el hex de 16 como forma canónica porque es la que emite el hardware, que es la
 * única fuente que no depende de cómo alguien haya tecleado.
 *
 * `IMMUTABLE` no es decorativo: sin ello Postgres no permite indexar por esta función, y el
 * cruce contra el inventario —204 ONUs hoy, todo el parque tras la migración de SmartOLT—
 * degradaría a recorrido secuencial en cada consulta del mapa.
 */
export class FnSnOnuNormalizado1791800000035 implements MigrationInterface {
  name = 'FnSnOnuNormalizado1791800000035';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE OR REPLACE FUNCTION sn_onu_normalizado(sn text) RETURNS text
      LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $fn$
        SELECT CASE
          -- Ya canónico: hex de 16 dígitos.
          WHEN sn ~ '^[0-9A-Fa-f]{16}$'           THEN upper(sn)
          -- Etiqueta del fabricante: 4 letras + 8 hex. Las letras pasan a sus bytes hex.
          WHEN sn ~ '^[A-Za-z]{4}[0-9A-Fa-f]{8}$' THEN
            upper(encode(convert_to(substring(sn from 1 for 4), 'UTF8'), 'hex') || substring(sn from 5))
          -- Formato desconocido: se devuelve en mayúsculas y NO se inventa una conversión.
          -- Un serial que no encaja debe fallar en comparar, no casar con el equipo de otro.
          ELSE upper(sn)
        END
      $fn$
    `);

    // Índices funcionales a ambos lados del cruce.
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_olt_onu_inventario_sn_norm
          ON olt_onu_inventario (sn_onu_normalizado(sn))
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_ftth_onu_registro_sn_norm
          ON ftth_onu_registro (sn_onu_normalizado(sn))
       WHERE deleted_at IS NULL
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_ftth_onu_registro_sn_norm`);
    await qr.query(`DROP INDEX IF EXISTS idx_olt_onu_inventario_sn_norm`);
    await qr.query(`DROP FUNCTION IF EXISTS sn_onu_normalizado(text)`);
  }
}
