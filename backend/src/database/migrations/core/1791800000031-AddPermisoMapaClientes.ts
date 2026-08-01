import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────────────────────
// Permiso `red:mapa:clientes` — capa de abonados del mapa de red.
//
// Separado de `mikrotik:view` a propósito: es la única capa que expone PII (nombre y
// domicilio georreferenciado de cada abonado) sobre un mapa navegable. Un técnico de
// campo necesita ver la planta —fibra, mufas, NAPs— para trabajar; no necesita el padrón
// completo ubicado casa por casa. Compartir permiso con "ver routers" convertiría el mapa
// de red en un directorio de domicilios para cualquiera con acceso a la sección.
//
// Se otorga sólo a los roles que ya administran datos de clientes. NO se da al Operador
// NOC ni a Técnico: su trabajo es la red, no el padrón. Un rol que necesite ambas cosas se
// ajusta desde la UI de roles, que para eso existe.
// ─────────────────────────────────────────────────────────────────────────────
export class AddPermisoMapaClientes1791800000031 implements MigrationInterface {
  name = 'AddPermisoMapaClientes1791800000031';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      INSERT INTO permisos (codigo, nombre, modulo)
      VALUES ('red:mapa:clientes', 'Ver capa de clientes en el mapa de red', 'red')
      ON CONFLICT (codigo) DO NOTHING
    `);

    // Se otorga a los roles que YA acceden al padrón por otras vías (ficha de cliente,
    // listados, reportes). Negarles la capa del mapa sería teatro de seguridad: verían
    // los mismos datos a dos clics de distancia.
    //
    // Queda FUERA de "Operador NOC" y "Técnico" a propósito: su trabajo es la red, y con
    // `mikrotik:view` siguen viendo toda la planta —fibra, mufas, NAPs, sites—. Si en una
    // instalación concreta necesitan también la capa de abonados, se les agrega desde la
    // UI de roles; el default no debe ser el permisivo.
    await qr.query(`
      INSERT INTO roles_permisos (rol_id, permiso_id)
      SELECT r.id, p.id
        FROM roles r
        CROSS JOIN permisos p
       WHERE p.codigo = 'red:mapa:clientes'
         AND r.nombre IN (
           'Super Administrador', 'Administrador', 'Supervisor', 'Atención al Cliente'
         )
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`
      DELETE FROM roles_permisos
       WHERE permiso_id IN (SELECT id FROM permisos WHERE codigo = 'red:mapa:clientes')
    `);
    await qr.query(`DELETE FROM permisos WHERE codigo = 'red:mapa:clientes'`);
  }
}
