import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────────────────────
// Separar el eco de peticiones HTTP de la actividad de negocio, con una columna.
//
// El AuditInterceptor escribe una fila por CADA request ("POST /api/v1/auth/refresh
// (2265ms)"): 24.670 de 25.776 registros, el 95% de la tabla. El Log del Sistema los
// filtraba comparando la FORMA de la descripción (`descripcion !~ '^(GET|POST…) /'`), que
// funciona pero es frágil: el día que un evento de negocio empiece por un verbo HTTP,
// desaparece de la pantalla sin que nadie lo note.
//
// Con la columna, la clasificación la decide quien ESCRIBE el registro, que es quien sabe
// lo que está escribiendo, en vez de adivinarse al leer.
//
// Además habilita la retención: hasta ahora nada recortaba la tabla y crecía sin límite.
// Los registros de negocio NO se purgan nunca —son la auditoría del sistema—; solo caduca
// el eco técnico.
// ─────────────────────────────────────────────────────────────────────────────
export class AuditoriaTipoYRetencion1791800000038 implements MigrationInterface {
  name = 'AuditoriaTipoYRetencion1791800000038';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE auditoria_logs
        ADD COLUMN IF NOT EXISTS tipo VARCHAR(10) NOT NULL DEFAULT 'negocio'
    `);

    // Backfill con el mismo criterio que usaba el filtro de lectura, aplicado UNA vez.
    await qr.query(`
      UPDATE auditoria_logs
         SET tipo = 'http'
       WHERE descripcion ~ '^(GET|POST|PATCH|PUT|DELETE) /'
         AND tipo <> 'http'
    `);

    // El índice cubre el acceso normal del Log: actividad de negocio, la más reciente
    // primero. Es parcial para no indexar el 95% que casi nunca se consulta.
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_auditoria_negocio_fecha
        ON auditoria_logs (empresa_id, created_at DESC)
        WHERE tipo = 'negocio'
    `);
    // Y este es el que usa la purga para encontrar lo caducado sin recorrer la tabla.
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_auditoria_http_fecha
        ON auditoria_logs (created_at)
        WHERE tipo = 'http'
    `);

    await qr.query(`
      COMMENT ON COLUMN auditoria_logs.tipo IS
        'negocio = actividad del ERP (se conserva siempre) | http = eco de una petición (caduca)'
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_auditoria_http_fecha`);
    await qr.query(`DROP INDEX IF EXISTS idx_auditoria_negocio_fecha`);
    await qr.query(`ALTER TABLE auditoria_logs DROP COLUMN IF EXISTS tipo`);
  }
}
