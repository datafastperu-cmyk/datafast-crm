import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 2 del plan del core — **el catálogo deja de tener forma de conexión de internet**.
 *
 * `planes` describía una y solo una cosa: un enlace con velocidad de bajada y de subida. Ocho de
 * sus columnas obligatorias son propiedades de una conexión, y dos de ellas —`velocidad_bajada` y
 * `velocidad_subida`— **no tienen valor por defecto**. Con eso un plan de cable coaxial es
 * literalmente inexpresable: hay que inventarle una velocidad.
 *
 * Y `planes.tipo` no servía para distinguirlos: es `residencial | empresarial | dedicado |
 * prepago`, un **segmento comercial**. Dos ejes distintos que el modelo no separaba porque nunca
 * hizo falta separarlos.
 *
 * Se añade `producto`, que es lo que el abonado contrata, y las columnas de conexión pasan a ser
 * opcionales — para quien no es una conexión. El valor por defecto es `internet`, así que los 7
 * planes existentes quedan correctamente clasificados sin tocarlos.
 *
 * **Lo que esta fase NO hace:** aprovisionar cable. Un contrato de cable no tiene router, así que
 * el camino de red simplemente no se ejecuta. Aquí se abre el catálogo; venderlo de punta a punta
 * llega con el nivel de contrato (fase 3).
 */
export class CatalogoAbiertoAProductos1791800000052 implements MigrationInterface {
  name = 'CatalogoAbiertoAProductos1791800000052';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE tipo_producto AS ENUM
          ('internet', 'cable_iptv', 'cable_coaxial', 'streaming');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE planes
        ADD COLUMN IF NOT EXISTS producto tipo_producto NOT NULL DEFAULT 'internet'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN planes.producto IS
        'Qué contrata el abonado. Es un eje distinto de planes.tipo (segmento comercial: '
        'residencial/empresarial/...) y de tipo_servicio (tecnología de acceso: wisp/ftth).'
    `);

    // Las columnas de conexión dejan de ser obligatorias. Solo estas tres: el resto de las ocho
    // ya tenían valor por defecto y un `false`/`0` es una respuesta honesta para un producto que
    // no es una conexión. Una velocidad inventada no lo es.
    await queryRunner.query(`ALTER TABLE planes ALTER COLUMN velocidad_bajada DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE planes ALTER COLUMN velocidad_subida DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE planes ALTER COLUMN tipo_servicio    DROP NOT NULL`);

    // La coherencia se defiende en la base, no solo en el servicio: un plan de internet SIN
    // velocidad es tan inválido como uno de streaming CON ella, y da igual por qué puerta entre.
    await queryRunner.query(`
      ALTER TABLE planes
        ADD CONSTRAINT planes_velocidad_solo_internet CHECK (
          (producto =  'internet' AND velocidad_bajada IS NOT NULL AND velocidad_subida IS NOT NULL)
       OR (producto <> 'internet' AND velocidad_bajada IS     NULL AND velocidad_subida IS     NULL)
        )
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_planes_producto ON planes (empresa_id, producto)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_planes_producto`);
    await queryRunner.query(`ALTER TABLE planes DROP CONSTRAINT IF EXISTS planes_velocidad_solo_internet`);
    // No se restauran los NOT NULL: si existe algún plan que no es una conexión, volver a
    // exigirle velocidad haría fallar la reversión con datos legítimos dentro.
    await queryRunner.query(`ALTER TABLE planes DROP COLUMN IF EXISTS producto`);
    await queryRunner.query(`DROP TYPE IF EXISTS tipo_producto`);
  }
}
