import { MigrationInterface, QueryRunner } from 'typeorm';

// ─────────────────────────────────────────────────────────────
// Migración: Roles adicionales + permisos extendidos
// Agrega: Super Administrador, Atención al Cliente, Cobranza,
//         Operador NOC, Invitado
// Agrega: permisos faltantes para VPN, personal, inventario,
//         configuración, licencias, logs, servicios
// ─────────────────────────────────────────────────────────────
export class AddRolesExtraAndPermisos1779500000001 implements MigrationInterface {
  name = 'AddRolesExtraAndPermisos1779500000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const empresa = 'a0000000-0000-0000-0000-000000000001';

    // ── 1. Nuevos permisos ────────────────────────────────────
    const nuevosPermisos = [
      // VPN
      { codigo: 'vpn:view',             nombre: 'Ver clientes VPN',           modulo: 'vpn' },
      { codigo: 'vpn:manage',           nombre: 'Gestionar clientes VPN',     modulo: 'vpn' },
      // OpenVPN
      { codigo: 'openvpn:view',         nombre: 'Ver configuración OpenVPN',  modulo: 'red' },
      { codigo: 'openvpn:manage',       nombre: 'Gestionar OpenVPN',          modulo: 'red' },
      // Personal
      { codigo: 'personal:view',        nombre: 'Ver usuarios y roles',       modulo: 'admin' },
      { codigo: 'personal:manage',      nombre: 'Gestionar usuarios y roles', modulo: 'admin' },
      // Inventario
      { codigo: 'inventario:view',      nombre: 'Ver inventario',             modulo: 'inventario' },
      { codigo: 'inventario:manage',    nombre: 'Gestionar inventario',       modulo: 'inventario' },
      // Configuración
      { codigo: 'configuracion:view',   nombre: 'Ver configuración',          modulo: 'admin' },
      { codigo: 'configuracion:manage', nombre: 'Gestionar configuración',    modulo: 'admin' },
      // Licencias
      { codigo: 'licencias:manage',     nombre: 'Gestionar licencia',         modulo: 'admin' },
      // Logs
      { codigo: 'logs:view',            nombre: 'Ver logs del sistema',       modulo: 'admin' },
      // Servicios
      { codigo: 'servicios:view',       nombre: 'Ver servicios de red',       modulo: 'red' },
      { codigo: 'servicios:manage',     nombre: 'Gestionar servicios de red', modulo: 'red' },
      // Facturación extendida
      { codigo: 'facturas:export',      nombre: 'Exportar facturas',          modulo: 'facturacion' },
      // Cortes
      { codigo: 'cortes:view',          nombre: 'Ver cortes de servicio',     modulo: 'contratos' },
      { codigo: 'cortes:manage',        nombre: 'Gestionar cortes',           modulo: 'contratos' },
    ];

    for (const p of nuevosPermisos) {
      await queryRunner.query(`
        INSERT INTO permisos (codigo, nombre, modulo)
        VALUES ('${p.codigo}', '${p.nombre}', '${p.modulo}')
        ON CONFLICT (codigo) DO NOTHING
      `);
    }

    // ── 2. Nuevos roles ───────────────────────────────────────
    const nuevosRoles = [
      {
        id:    'b0000000-0000-0000-0000-000000000010',
        nombre: 'Super Administrador',
        desc:  'Acceso total al sistema sin restricciones',
      },
      {
        id:    'b0000000-0000-0000-0000-000000000006',
        nombre: 'Atención al Cliente',
        desc:  'Atención y soporte al cliente, sin modificar configuraciones',
      },
      {
        id:    'b0000000-0000-0000-0000-000000000007',
        nombre: 'Cobranza',
        desc:  'Gestión de pagos, facturas y morosidad',
      },
      {
        id:    'b0000000-0000-0000-0000-000000000008',
        nombre: 'Operador NOC',
        desc:  'Monitoreo de red, routers y OLTs',
      },
      {
        id:    'b0000000-0000-0000-0000-000000000009',
        nombre: 'Invitado',
        desc:  'Acceso de solo lectura al sistema',
      },
    ];

    for (const r of nuevosRoles) {
      await queryRunner.query(`
        INSERT INTO roles (id, empresa_id, nombre, descripcion, es_sistema)
        VALUES ('${r.id}', '${empresa}', '${r.nombre}', '${r.desc}', TRUE)
        ON CONFLICT (empresa_id, nombre) DO NOTHING
      `);
    }

    // ── 3. Super Administrador — todos los permisos ───────────
    await queryRunner.query(`
      INSERT INTO roles_permisos (rol_id, permiso_id)
      SELECT 'b0000000-0000-0000-0000-000000000010', id FROM permisos
      ON CONFLICT DO NOTHING
    `);

    // ── 4. Atención al Cliente ────────────────────────────────
    await queryRunner.query(`
      INSERT INTO roles_permisos (rol_id, permiso_id)
      SELECT 'b0000000-0000-0000-0000-000000000006', id FROM permisos
      WHERE codigo IN (
        'clientes:view', 'clientes:create', 'clientes:edit',
        'contratos:view',
        'facturas:view', 'facturas:send',
        'pagos:view',
        'tickets:view', 'tickets:create', 'tickets:edit',
        'ordenes:view', 'ordenes:create',
        'planes:view',
        'reports:view'
      )
      ON CONFLICT DO NOTHING
    `);

    // ── 5. Cobranza ───────────────────────────────────────────
    await queryRunner.query(`
      INSERT INTO roles_permisos (rol_id, permiso_id)
      SELECT 'b0000000-0000-0000-0000-000000000007', id FROM permisos
      WHERE codigo IN (
        'clientes:view',
        'contratos:view', 'contratos:suspend', 'contratos:reactivate',
        'facturas:view', 'facturas:create', 'facturas:send', 'facturas:export',
        'pagos:view', 'pagos:create', 'pagos:verify', 'pagos:conciliar',
        'cortes:view', 'cortes:manage',
        'reports:view', 'reports:financial'
      )
      ON CONFLICT DO NOTHING
    `);

    // ── 6. Operador NOC ───────────────────────────────────────
    await queryRunner.query(`
      INSERT INTO roles_permisos (rol_id, permiso_id)
      SELECT 'b0000000-0000-0000-0000-000000000008', id FROM permisos
      WHERE codigo IN (
        'clientes:view',
        'contratos:view',
        'mikrotik:view', 'mikrotik:manage',
        'onu:view', 'onu:provision',
        'redes:view', 'redes:manage',
        'monitoring:view', 'monitoring:manage',
        'vpn:view', 'openvpn:view',
        'servicios:view', 'servicios:manage',
        'tickets:view', 'tickets:create',
        'logs:view'
      )
      ON CONFLICT DO NOTHING
    `);

    // ── 7. Invitado — solo vista ──────────────────────────────
    await queryRunner.query(`
      INSERT INTO roles_permisos (rol_id, permiso_id)
      SELECT 'b0000000-0000-0000-0000-000000000009', id FROM permisos
      WHERE codigo LIKE '%:view'
      ON CONFLICT DO NOTHING
    `);

    // ── 8. Actualizar el usuario admin para que tenga Super Administrador ──
    await queryRunner.query(`
      INSERT INTO usuarios_roles (usuario_id, rol_id)
      VALUES (
        'c0000000-0000-0000-0000-000000000001',
        'b0000000-0000-0000-0000-000000000010'
      )
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const roles = [
      'b0000000-0000-0000-0000-000000000010',
      'b0000000-0000-0000-0000-000000000006',
      'b0000000-0000-0000-0000-000000000007',
      'b0000000-0000-0000-0000-000000000008',
      'b0000000-0000-0000-0000-000000000009',
    ];

    for (const id of roles) {
      await queryRunner.query(`DELETE FROM roles_permisos WHERE rol_id = '${id}'`);
      await queryRunner.query(`DELETE FROM roles WHERE id = '${id}'`);
    }

    const codigos = [
      'vpn:view', 'vpn:manage', 'openvpn:view', 'openvpn:manage',
      'personal:view', 'personal:manage', 'inventario:view', 'inventario:manage',
      'configuracion:view', 'configuracion:manage', 'licencias:manage', 'logs:view',
      'servicios:view', 'servicios:manage', 'facturas:export', 'cortes:view', 'cortes:manage',
    ];
    await queryRunner.query(`DELETE FROM permisos WHERE codigo IN (${codigos.map((c) => `'${c}'`).join(',')})`);
  }
}
