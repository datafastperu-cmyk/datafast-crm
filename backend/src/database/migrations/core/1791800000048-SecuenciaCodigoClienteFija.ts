import { MigrationInterface, QueryRunner } from 'typeorm';

// Prerrequisito de B-15: quitarle a la aplicación el último DDL en tiempo de ejecución.
//
// `generarCodigoCliente` ejecutaba `CREATE SEQUENCE IF NOT EXISTS seq_cod_cli_<empresaId>`
// en CADA alta de cliente. Eso obliga al rol de la base a tener `CREATE` sobre el esquema —
// justo el privilegio que hay que quitarle para que deje de ser superusuario.
//
// Y no basta con que la secuencia ya exista: **PostgreSQL comprueba el permiso del esquema
// ANTES de evaluar el `IF NOT EXISTS`**. Medido contra la base real el 2026-08-08 con un rol
// mínimo de prueba: `permission denied for schema public` incluso sobre una secuencia que ya
// estaba creada. Sin esta migración, des-privilegiar el rol rompería el alta de clientes.
//
// La secuencia pasa a ser ÚNICA y de nombre fijo, en vez de una por empresa: ADR-031 fija
// que una instalación sirve a exactamente una empresa. De paso desaparece la interpolación
// de un identificador dentro de una sentencia DDL.
export class SecuenciaCodigoClienteFija1791800000048 implements MigrationInterface {
  name = 'SecuenciaCodigoClienteFija1791800000048';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`CREATE SEQUENCE IF NOT EXISTS seq_codigo_cliente START 1 INCREMENT 1`);

    // Continuidad: se arranca por encima del valor que llevaran las secuencias por empresa,
    // para no repetir un código ya emitido. Si no había ninguna, se queda en 1.
    const previas: Array<{ maximo: string | null }> = await qr.query(`
      SELECT MAX(last_value)::text AS maximo
        FROM pg_sequences
       WHERE schemaname = 'public'
         AND sequencename LIKE 'seq_cod_cli%'
    `);
    const desde = parseInt(previas[0]?.maximo ?? '0', 10);
    if (desde > 0) {
      await qr.query(`SELECT setval('seq_codigo_cliente', $1, true)`, [String(desde)]);
    }

    await qr.query(`
      COMMENT ON SEQUENCE seq_codigo_cliente IS
        'Correlativo de codigo de cliente. Nombre fijo y creada por migracion a proposito: la aplicacion no debe poder ejecutar DDL (B-15). Una sola por instalacion (ADR-031).'
    `);

    // Las secuencias por empresa quedan donde están: borrarlas no aporta nada y una
    // instalación que revierta esta migración las necesitaría.
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP SEQUENCE IF EXISTS seq_codigo_cliente`);
  }
}
