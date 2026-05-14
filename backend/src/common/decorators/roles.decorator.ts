import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const PERMISSIONS_KEY = 'permissions';

// ─── Requerir uno o más roles ─────────────────────────────────
// Uso: @Roles('admin', 'supervisor')
export const Roles = (...roles: string[]) =>
  SetMetadata(ROLES_KEY, roles);

// ─── Requerir un permiso específico ───────────────────────────
// Uso: @RequirePermission('clientes:create')
export const RequirePermission = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

// ─── Roles predefinidos del sistema ──────────────────────────
export enum Role {
  ADMIN = 'admin',
  SUPERVISOR = 'supervisor',
  VENDEDOR = 'vendedor',
  CAJERO = 'cajero',
  TECNICO = 'tecnico',
  CLIENTE = 'cliente',
}

// ─── Permisos granulares del sistema ─────────────────────────
export enum Permission {
  // Clientes
  CLIENTES_VIEW   = 'clientes:view',
  CLIENTES_CREATE = 'clientes:create',
  CLIENTES_EDIT   = 'clientes:edit',
  CLIENTES_DELETE = 'clientes:delete',

  // Facturación
  FACTURAS_VIEW   = 'facturas:view',
  FACTURAS_CREATE = 'facturas:create',
  FACTURAS_DELETE = 'facturas:delete',

  // Pagos
  PAGOS_VIEW      = 'pagos:view',
  PAGOS_CREATE    = 'pagos:create',
  PAGOS_VERIFY    = 'pagos:verify',

  // Red
  MIKROTIK_VIEW   = 'mikrotik:view',
  MIKROTIK_MANAGE = 'mikrotik:manage',
  ONU_PROVISION   = 'onu:provision',
  ONU_VIEW        = 'onu:view',

  // Monitoreo
  MONITORING_VIEW = 'monitoring:view',

  // Tickets
  TICKETS_VIEW    = 'tickets:view',
  TICKETS_CREATE  = 'tickets:create',
  TICKETS_MANAGE  = 'tickets:manage',

  // Reportes
  REPORTS_VIEW    = 'reports:view',
  REPORTS_EXPORT  = 'reports:export',

  // Administración
  USERS_MANAGE    = 'users:manage',
  ROLES_MANAGE    = 'roles:manage',
  SYSTEM_CONFIG   = 'system:config',
}
