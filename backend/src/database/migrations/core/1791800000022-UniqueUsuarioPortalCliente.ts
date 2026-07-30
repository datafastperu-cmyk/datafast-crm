import { MigrationInterface, QueryRunner } from 'typeorm';

// Unicidad de `clientes.usuario_portal` — prerrequisito del Portal del Cliente.
//
// `usuario_portal` / `password_portal` existen desde 1780700000000 y son campos
// OBLIGATORIOS en Detalle del Cliente, pero nunca tuvieron restricción de unicidad
// porque hasta hoy nada los consumía: no existe endpoint de login del portal.
//
// El login que se construye sobre estos campos resuelve `usuario -> cliente`. Sin
// unicidad esa resolución es ambigua: dos clientes con el mismo usuario hacen que el
// primero que devuelva el motor gane, y quien conozca el usuario de otro abonado puede
// terminar dentro de una cuenta ajena — con su deuda, sus datos personales y el control
// de su WiFi. El índice se crea ANTES del login, no después.
//
// Comparación case-insensitive (`lower()`): un portal donde "JPEREZ" y "jperez" son dos
// cuentas distintas es una trampa para el abonado y para el operador que emite las
// credenciales.
export class UniqueUsuarioPortalCliente1791800000022 implements MigrationInterface {
  name = 'UniqueUsuarioPortalCliente1791800000022';

  public async up(qr: QueryRunner): Promise<void> {
    // 1) Normalizar espacios accidentales del alta manual. `''` pasa a NULL para que
    //    un usuario vacío no compita por el índice ni habilite un login sin usuario.
    await qr.query(`
      UPDATE clientes
         SET usuario_portal = NULLIF(btrim(usuario_portal), '')
       WHERE usuario_portal IS NOT NULL
         AND usuario_portal IS DISTINCT FROM NULLIF(btrim(usuario_portal), '')
    `);

    // 2) Resolver duplicados ANTES de crear el índice: con ellos presentes la creación
    //    falla y bloquea el deploy completo.
    //
    //    Regla determinista: CONSERVA el usuario del cliente con contratos vigentes; a
    //    igualdad, el más antiguo (el registro original — los demás son altas repetidas).
    //    A los perdedores se les pone `usuario_portal = NULL`.
    //
    //    Esto no deja a nadie fuera de su portal: el portal todavía no existe, así que
    //    hoy nadie usa estas credenciales. El operador reemite el usuario del cliente
    //    afectado desde Detalle del Cliente, que es el único camino previsto (el abonado
    //    no administra su propia clave).
    //
    //    `password_portal` NO se toca: es un hash bcrypt sin valor por sí solo y
    //    borrarlo destruiría información que la reemisión puede aprovechar.
    const perdedores: Array<{ id: string; empresa_id: string; usuario_portal: string }> =
      await qr.query(`
        WITH ranked AS (
          SELECT c.id,
                 c.empresa_id,
                 c.usuario_portal,
                 ROW_NUMBER() OVER (
                   PARTITION BY c.empresa_id, lower(c.usuario_portal)
                   ORDER BY (SELECT count(*) FROM contratos ct
                              WHERE ct.cliente_id = c.id AND ct.deleted_at IS NULL) DESC,
                            c.created_at ASC
                 ) AS pos
            FROM clientes c
           WHERE c.usuario_portal IS NOT NULL
             AND c.deleted_at IS NULL
        )
        SELECT id, empresa_id, usuario_portal FROM ranked WHERE pos > 1
      `);

    if (perdedores.length > 0) {
      await qr.query(
        `UPDATE clientes SET usuario_portal = NULL WHERE id = ANY($1::uuid[])`,
        [perdedores.map((p) => p.id)],
      );

      // 3) Que quede constancia en el Centro de Operaciones. Un cliente cuyo usuario
      //    se anuló en silencio es un ticket de soporte sin explicación el día que el
      //    portal entre en servicio.
      await qr.query(
        `INSERT INTO eventos_sistema (nivel, origen, codigo, mensaje, contexto)
         VALUES ('warn', 'migracion', 'PORTAL_USUARIO_DUPLICADO', $1, $2::jsonb)`,
        [
          `Se anuló usuario_portal duplicado en ${perdedores.length} cliente(s). ` +
            `Reemitir credenciales desde Detalle del Cliente antes de habilitar el portal.`,
          JSON.stringify({ afectados: perdedores }),
        ],
      );
    }

    // 4) El invariante pasa a estar garantizado por el motor, no por la disciplina de
    //    quien da de alta al cliente.
    await qr.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_clientes_usuario_portal
        ON clientes (empresa_id, lower(usuario_portal))
        WHERE usuario_portal IS NOT NULL AND deleted_at IS NULL
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    // Solo se retira el índice. Los `usuario_portal` anulados NO se restauran: hacerlo
    // recrearía los duplicados que motivaron la migración, y elegir cuál cliente conserva
    // qué usuario es una decisión de operación, no de un rollback automático. El detalle
    // de lo anulado queda en eventos_sistema.
    await qr.query(`DROP INDEX IF EXISTS ux_clientes_usuario_portal`);
  }
}
