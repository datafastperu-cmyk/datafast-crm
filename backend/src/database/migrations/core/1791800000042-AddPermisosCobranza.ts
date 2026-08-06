import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────────────────────
// Permisos del módulo de cobranza (F4/F5).
//
// Separados a propósito, por segregación de funciones: quien cobra no debería ser quien
// verifica, ni quien anula, ni quien decide en qué cuenta entró el dinero. Es el control
// antifraude más barato que existe en un módulo de caja, y no cuesta nada implementarlo
// mientras el módulo se está construyendo.
//
// `pagos:extornar_conciliado` es aparte del extorno normal porque anular un pago YA
// conciliado con el extracto bancario rompe un cierre contable que alguien dio por
// cerrado. A veces hay que hacerlo —un contracargo llega semanas después— pero no es la
// misma decisión que corregir un error de digitación de esta mañana.
// ─────────────────────────────────────────────────────────────────────────────
export class AddPermisosCobranza1791800000042 implements MigrationInterface {
  name = 'AddPermisosCobranza1791800000042';

  private readonly permisos: Array<[string, string, string[]]> = [
    // codigo, nombre, roles a los que se otorga
    ['pagos:extornar',            'Extornar (anular) un pago',
      ['Administrador', 'Supervisor']],
    ['pagos:extornar_conciliado', 'Extornar un pago ya conciliado con el banco',
      ['Administrador']],
    ['cobranza:cambiar_cuenta',   'Cambiar la cuenta receptora sugerida por el canal',
      ['Administrador', 'Supervisor']],
    ['cobranza:configurar',       'Configurar canales, cuentas y comisiones de cobranza',
      ['Administrador']],
    ['cobranza:cerrar_caja',      'Cerrar y arquear una caja',
      ['Administrador', 'Supervisor']],
    ['cobranza:fecha_retroactiva', 'Registrar un cobro con fecha anterior a hoy',
      ['Administrador', 'Supervisor']],
  ];

  public async up(qr: QueryRunner): Promise<void> {
    for (const [codigo, nombre, roles] of this.permisos) {
      await qr.query(
        `INSERT INTO permisos (codigo, nombre, modulo)
         VALUES ($1, $2, 'cobranza')
         ON CONFLICT (codigo) DO NOTHING`,
        [codigo, nombre],
      );
      await qr.query(
        `INSERT INTO roles_permisos (rol_id, permiso_id)
         SELECT r.id, p.id
           FROM roles r CROSS JOIN permisos p
          WHERE p.codigo = $1 AND r.nombre = ANY($2::text[])
         ON CONFLICT DO NOTHING`,
        [codigo, roles],
      );
    }
  }

  public async down(qr: QueryRunner): Promise<void> {
    const codigos = this.permisos.map(([c]) => c);
    await qr.query(
      `DELETE FROM roles_permisos WHERE permiso_id IN
         (SELECT id FROM permisos WHERE codigo = ANY($1::text[]))`,
      [codigos],
    );
    await qr.query(`DELETE FROM permisos WHERE codigo = ANY($1::text[])`, [codigos]);
  }
}
