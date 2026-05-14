import { MigrationInterface, QueryRunner } from 'typeorm';
import * as bcrypt from 'bcryptjs';

// ─────────────────────────────────────────────────────────────
// Migración 010 — Seeds iniciales
// Datos necesarios para arrancar el sistema:
// - Empresa demo
// - Permisos del sistema (todos)
// - Roles predefinidos con permisos
// - Usuario administrador inicial
// ─────────────────────────────────────────────────────────────
export class SeedInitialData1700000010000 implements MigrationInterface {
  name = 'SeedInitialData1700000010000';

  public async up(queryRunner: QueryRunner): Promise<void> {

    // ── 1. Empresa demo ───────────────────────────────────────
    await queryRunner.query(`
      INSERT INTO empresas (
        id, razon_social, nombre_comercial, ruc,
        telefono, email, moneda, simbolo_moneda,
        igv_rate, dia_facturacion, dias_gracia,
        serie_boleta, serie_factura, estado
      ) VALUES (
        'a0000000-0000-0000-0000-000000000001',
        'FibraNet Internet S.A.C.',
        'FibraNet ISP',
        '20600000001',
        '+51 073 000000',
        'admin@fibranet.pe',
        'PEN', 'S/',
        0.18, 1, 5,
        'B001', 'F001', 'activo'
      )
      ON CONFLICT (ruc) DO NOTHING
    `);

    // ── 2. Permisos del sistema ────────────────────────────────
    const permisos = [
      // Clientes
      { codigo: 'clientes:view',         nombre: 'Ver clientes',               modulo: 'clientes' },
      { codigo: 'clientes:create',        nombre: 'Crear clientes',             modulo: 'clientes' },
      { codigo: 'clientes:edit',          nombre: 'Editar clientes',            modulo: 'clientes' },
      { codigo: 'clientes:delete',        nombre: 'Eliminar clientes',          modulo: 'clientes' },
      { codigo: 'clientes:export',        nombre: 'Exportar clientes',          modulo: 'clientes' },
      // Contratos
      { codigo: 'contratos:view',         nombre: 'Ver contratos',              modulo: 'contratos' },
      { codigo: 'contratos:create',       nombre: 'Crear contratos',            modulo: 'contratos' },
      { codigo: 'contratos:edit',         nombre: 'Editar contratos',           modulo: 'contratos' },
      { codigo: 'contratos:delete',       nombre: 'Eliminar contratos',         modulo: 'contratos' },
      { codigo: 'contratos:suspend',      nombre: 'Suspender contratos',        modulo: 'contratos' },
      { codigo: 'contratos:reactivate',   nombre: 'Reactivar contratos',        modulo: 'contratos' },
      { codigo: 'contratos:prorroga',     nombre: 'Otorgar prórrogas',          modulo: 'contratos' },
      // Facturación
      { codigo: 'facturas:view',          nombre: 'Ver facturas',               modulo: 'facturacion' },
      { codigo: 'facturas:create',        nombre: 'Crear facturas',             modulo: 'facturacion' },
      { codigo: 'facturas:delete',        nombre: 'Anular facturas',            modulo: 'facturacion' },
      { codigo: 'facturas:send',          nombre: 'Enviar facturas',            modulo: 'facturacion' },
      // Pagos
      { codigo: 'pagos:view',             nombre: 'Ver pagos',                  modulo: 'pagos' },
      { codigo: 'pagos:create',           nombre: 'Registrar pagos',            modulo: 'pagos' },
      { codigo: 'pagos:verify',           nombre: 'Verificar/aprobar pagos',    modulo: 'pagos' },
      { codigo: 'pagos:delete',           nombre: 'Anular pagos',               modulo: 'pagos' },
      { codigo: 'pagos:conciliar',        nombre: 'Conciliar pagos',            modulo: 'pagos' },
      // Red
      { codigo: 'mikrotik:view',          nombre: 'Ver routers Mikrotik',       modulo: 'red' },
      { codigo: 'mikrotik:manage',        nombre: 'Gestionar routers Mikrotik', modulo: 'red' },
      { codigo: 'onu:view',               nombre: 'Ver ONUs',                   modulo: 'red' },
      { codigo: 'onu:provision',          nombre: 'Aprovisionar ONUs',          modulo: 'red' },
      { codigo: 'redes:view',             nombre: 'Ver segmentos IPv4',          modulo: 'red' },
      { codigo: 'redes:manage',           nombre: 'Gestionar segmentos IPv4',    modulo: 'red' },
      // Monitoreo
      { codigo: 'monitoring:view',        nombre: 'Ver monitoreo de red',       modulo: 'monitoreo' },
      { codigo: 'monitoring:manage',      nombre: 'Gestionar alertas',          modulo: 'monitoreo' },
      // Tickets
      { codigo: 'tickets:view',           nombre: 'Ver tickets',                modulo: 'soporte' },
      { codigo: 'tickets:create',         nombre: 'Crear tickets',              modulo: 'soporte' },
      { codigo: 'tickets:edit',           nombre: 'Editar tickets',             modulo: 'soporte' },
      { codigo: 'tickets:manage',         nombre: 'Gestionar tickets (asignar)', modulo: 'soporte' },
      { codigo: 'ordenes:view',           nombre: 'Ver órdenes de trabajo',     modulo: 'soporte' },
      { codigo: 'ordenes:create',         nombre: 'Crear órdenes de trabajo',   modulo: 'soporte' },
      { codigo: 'ordenes:manage',         nombre: 'Gestionar órdenes de trabajo', modulo: 'soporte' },
      // Reportes
      { codigo: 'reports:view',           nombre: 'Ver reportes',               modulo: 'reportes' },
      { codigo: 'reports:export',         nombre: 'Exportar reportes',          modulo: 'reportes' },
      { codigo: 'reports:financial',      nombre: 'Ver reportes financieros',   modulo: 'reportes' },
      // Administración
      { codigo: 'planes:view',            nombre: 'Ver planes',                 modulo: 'admin' },
      { codigo: 'planes:manage',          nombre: 'Gestionar planes',           modulo: 'admin' },
      { codigo: 'users:view',             nombre: 'Ver usuarios del sistema',   modulo: 'admin' },
      { codigo: 'users:manage',           nombre: 'Gestionar usuarios',         modulo: 'admin' },
      { codigo: 'roles:manage',           nombre: 'Gestionar roles',            modulo: 'admin' },
      { codigo: 'system:config',          nombre: 'Configuración del sistema',  modulo: 'admin' },
      { codigo: 'empresa:config',         nombre: 'Configurar datos empresa',   modulo: 'admin' },
    ];

    for (const p of permisos) {
      await queryRunner.query(`
        INSERT INTO permisos (codigo, nombre, modulo)
        VALUES ('${p.codigo}', '${p.nombre}', '${p.modulo}')
        ON CONFLICT (codigo) DO NOTHING
      `);
    }

    // ── 3. Roles del sistema ───────────────────────────────────
    const empresa = 'a0000000-0000-0000-0000-000000000001';

    const roles = [
      { id: 'b0000000-0000-0000-0000-000000000001', nombre: 'Administrador',  desc: 'Acceso total al sistema' },
      { id: 'b0000000-0000-0000-0000-000000000002', nombre: 'Supervisor',     desc: 'Supervisa operaciones y reportes' },
      { id: 'b0000000-0000-0000-0000-000000000003', nombre: 'Cajero',         desc: 'Registra y verifica pagos' },
      { id: 'b0000000-0000-0000-0000-000000000004', nombre: 'Vendedor',       desc: 'Alta de clientes y contratos' },
      { id: 'b0000000-0000-0000-0000-000000000005', nombre: 'Técnico',        desc: 'Instalaciones y soporte técnico' },
    ];

    for (const r of roles) {
      await queryRunner.query(`
        INSERT INTO roles (id, empresa_id, nombre, descripcion, es_sistema)
        VALUES ('${r.id}', '${empresa}', '${r.nombre}', '${r.desc}', TRUE)
        ON CONFLICT (empresa_id, nombre) DO NOTHING
      `);
    }

    // ── 4. Asignar permisos a roles ────────────────────────────

    // Administrador: todos los permisos
    await queryRunner.query(`
      INSERT INTO roles_permisos (rol_id, permiso_id)
      SELECT 'b0000000-0000-0000-0000-000000000001', id FROM permisos
      ON CONFLICT DO NOTHING
    `);

    // Supervisor: sin gestión de usuarios/roles/config sistema
    await queryRunner.query(`
      INSERT INTO roles_permisos (rol_id, permiso_id)
      SELECT 'b0000000-0000-0000-0000-000000000002', id FROM permisos
      WHERE codigo NOT IN ('users:manage', 'roles:manage', 'system:config', 'empresa:config',
                           'clientes:delete', 'facturas:delete', 'pagos:delete')
      ON CONFLICT DO NOTHING
    `);

    // Cajero: pagos + facturas + ver clientes
    await queryRunner.query(`
      INSERT INTO roles_permisos (rol_id, permiso_id)
      SELECT 'b0000000-0000-0000-0000-000000000003', id FROM permisos
      WHERE codigo IN (
        'clientes:view', 'contratos:view',
        'facturas:view', 'facturas:send',
        'pagos:view', 'pagos:create', 'pagos:verify',
        'reports:view', 'reports:financial'
      )
      ON CONFLICT DO NOTHING
    `);

    // Vendedor: alta de clientes y contratos
    await queryRunner.query(`
      INSERT INTO roles_permisos (rol_id, permiso_id)
      SELECT 'b0000000-0000-0000-0000-000000000004', id FROM permisos
      WHERE codigo IN (
        'clientes:view', 'clientes:create', 'clientes:edit',
        'contratos:view', 'contratos:create',
        'planes:view',
        'facturas:view',
        'pagos:view',
        'tickets:view', 'tickets:create',
        'reports:view'
      )
      ON CONFLICT DO NOTHING
    `);

    // Técnico: tickets + órdenes de trabajo + monitoreo + ONUs
    await queryRunner.query(`
      INSERT INTO roles_permisos (rol_id, permiso_id)
      SELECT 'b0000000-0000-0000-0000-000000000005', id FROM permisos
      WHERE codigo IN (
        'clientes:view', 'contratos:view',
        'tickets:view', 'tickets:create', 'tickets:edit',
        'ordenes:view', 'ordenes:create',
        'monitoring:view',
        'onu:view', 'onu:provision',
        'mikrotik:view',
        'redes:view'
      )
      ON CONFLICT DO NOTHING
    `);

    // ── 5. Usuario administrador inicial ──────────────────────
    // CAMBIAR ESTE PASSWORD INMEDIATAMENTE después del primer login
    const passwordHash = await bcrypt.hash('Admin@FibraNet2024!', 12);

    await queryRunner.query(`
      INSERT INTO usuarios (
        id, empresa_id, nombres, apellidos, email,
        password_hash, estado, email_verificado
      ) VALUES (
        'c0000000-0000-0000-0000-000000000001',
        'a0000000-0000-0000-0000-000000000001',
        'Super', 'Administrador',
        'admin@fibranet.pe',
        '${passwordHash}',
        'activo', TRUE
      )
      ON CONFLICT (empresa_id, email) DO NOTHING
    `);

    // Asignar rol admin al usuario inicial
    await queryRunner.query(`
      INSERT INTO usuarios_roles (usuario_id, rol_id)
      VALUES (
        'c0000000-0000-0000-0000-000000000001',
        'b0000000-0000-0000-0000-000000000001'
      )
      ON CONFLICT DO NOTHING
    `);

    // ── 6. Planes de ejemplo ──────────────────────────────────
    await queryRunner.query(`
      INSERT INTO planes (
        empresa_id, nombre, descripcion, tipo,
        velocidad_bajada, velocidad_subida,
        precio, tipo_queue, ppp_profile,
        color_ui, activo, visible_en_portal
      ) VALUES
        ('a0000000-0000-0000-0000-000000000001', 'Plan 10 Mbps', 'Internet básico residencial', 'residencial', 10, 5, 45.00, 'simple_queue', 'plan-10mbps', '#6B7280', true, true),
        ('a0000000-0000-0000-0000-000000000001', 'Plan 20 Mbps', 'Internet estándar', 'residencial', 20, 10, 65.00, 'simple_queue', 'plan-20mbps', '#3B82F6', true, true),
        ('a0000000-0000-0000-0000-000000000001', 'Plan 30 Mbps', 'Internet rápido', 'residencial', 30, 15, 85.00, 'simple_queue', 'plan-30mbps', '#8B5CF6', true, true),
        ('a0000000-0000-0000-0000-000000000001', 'Plan 50 Mbps', 'Internet premium', 'residencial', 50, 25, 110.00, 'simple_queue', 'plan-50mbps', '#F59E0B', true, true),
        ('a0000000-0000-0000-0000-000000000001', 'Plan 100 Mbps', 'Internet empresarial', 'empresarial', 100, 50, 180.00, 'queue_tree', 'plan-100mbps', '#10B981', true, true),
        ('a0000000-0000-0000-0000-000000000001', 'Plan 200 Mbps', 'Enlace dedicado', 'dedicado', 200, 200, 350.00, 'pcq', 'plan-200mbps', '#EF4444', true, false)
      ON CONFLICT (empresa_id, nombre) DO NOTHING
    `);

    // ── Log del seed ──────────────────────────────────────────
    await queryRunner.query(`
      INSERT INTO auditoria_logs (
        empresa_id, accion, modulo, descripcion
      ) VALUES (
        'a0000000-0000-0000-0000-000000000001',
        'SEED',
        'sistema',
        'Seeds iniciales aplicados: empresa demo, permisos, roles y usuario administrador'
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM auditoria_logs WHERE accion = 'SEED'`);
    await queryRunner.query(`DELETE FROM planes WHERE empresa_id = 'a0000000-0000-0000-0000-000000000001'`);
    await queryRunner.query(`DELETE FROM usuarios_roles WHERE usuario_id = 'c0000000-0000-0000-0000-000000000001'`);
    await queryRunner.query(`DELETE FROM usuarios WHERE id = 'c0000000-0000-0000-0000-000000000001'`);
    await queryRunner.query(`DELETE FROM roles_permisos WHERE rol_id IN (SELECT id FROM roles WHERE empresa_id = 'a0000000-0000-0000-0000-000000000001')`);
    await queryRunner.query(`DELETE FROM roles WHERE empresa_id = 'a0000000-0000-0000-0000-000000000001'`);
    await queryRunner.query(`DELETE FROM permisos WHERE codigo LIKE '%:%'`);
    await queryRunner.query(`DELETE FROM empresas WHERE id = 'a0000000-0000-0000-0000-000000000001'`);
  }
}
