import { MigrationInterface, QueryRunner } from 'typeorm';

// ADR-031: el ERP es mono-empresa por diseño. Una instalación sirve a exactamente una
// empresa; un segundo operador implica otra instalación, desde cero.
//
// Esta migración convierte esa decisión en una BARRERA. Sin ella, ADR-031 sería una
// intención escrita en un documento, y un `INSERT` de una "empresa de pruebas" dentro de
// producción reabriría en silencio el riesgo completo de la desviación A-1 —sobre 492
// consultas que ya nadie estaría vigilando, porque el documento diría que el problema no
// existe—. Una garantía que nadie sostiene es peor que ninguna.
//
// El índice único sobre la expresión constante `(TRUE)` es la forma estándar en PostgreSQL
// de limitar una tabla a una sola fila: todas las filas producirían la misma clave.
//
// SI ALGÚN DÍA HAY QUE RETIRARLO, ese es exactamente el momento de leer ADR-031 §4.2:
// significa que el ERP pasa a ser multi-empresa, y entonces vuelven a hacer falta el
// barrido de aislamiento y la discusión sobre RLS (bloqueada, a su vez, por B-15).
export class UnicaEmpresaPorInstalacion1791800000047 implements MigrationInterface {
  name = 'UnicaEmpresaPorInstalacion1791800000047';

  public async up(qr: QueryRunner): Promise<void> {
    // Guard explícito antes de crear el índice: si una instalación ya tuviera más de una
    // empresa, la migración debe FALLAR con un mensaje que se entienda, no con un error de
    // índice duplicado que obligue a adivinar qué pasó.
    const filas: Array<{ n: string }> = await qr.query(`SELECT COUNT(*)::text AS n FROM empresas`);
    const n = parseInt(filas[0]?.n ?? '0', 10);
    if (n > 1) {
      throw new Error(
        `ADR-031 asume una sola empresa por instalación y esta base tiene ${n}. ` +
        `No se aplica la restricción: revisa si esta instalación es realmente multi-empresa ` +
        `(entonces hay que revertir ADR-031 y reactivar el barrido de aislamiento) o si hay ` +
        `filas de prueba que deban eliminarse antes.`,
      );
    }

    await qr.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS unica_empresa_por_instalacion
        ON empresas ((TRUE))
    `);

    await qr.query(`
      COMMENT ON INDEX unica_empresa_por_instalacion IS
        'ADR-031: una instalacion = una empresa. Retirar este indice significa convertir el ERP en multi-empresa; leer ADR-031 antes.'
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS unica_empresa_por_instalacion`);
  }
}
