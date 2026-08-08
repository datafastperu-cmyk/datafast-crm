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

// ─── Aquí había un `enum Role`. Se BORRÓ el 2026-08-08, y no debe volver ─────
//
// Declaraba `ADMIN = 'admin'`, `SUPERVISOR = 'supervisor'`, `CAJERO = 'cajero'`… y **ninguno
// de esos valores corresponde a un rol real**. Verificado contra la base de producción, los
// diez que existen son:
//
//   Administrador · Super Administrador · Supervisor · Cajero · Vendedor
//   Técnico · Atención al Cliente · Cobranza · Operador NOC · Invitado
//
// En minúscula y sin tilde no coincide ninguno, así que `@Roles(Role.ADMIN)` dejaba el
// endpoint **inalcanzable para todo el mundo**. Ya ocurrió: `auditoria/papelera/eliminar`
// exigía `'admin'` y `'superadmin'`, y nadie podía purgar la papelera. Falla cerrado —la
// dirección segura— pero deja una función muerta que nada delata.
//
// **No se corrigieron los valores: se borró el enum.** Dos razones.
//
// 1. **Los roles son DATOS.** Viven en la tabla `roles` y varían entre instalaciones: esta
//    tenía diez cuando el `seed` solo crea cinco. Un enum en código sería una segunda fuente
//    de verdad para algo que ya tiene la suya (R-006 · ADR-032 · PA-12).
// 2. **No lo usaba nadie.** Un enum equivocado y sin consumidores no es documentación: es una
//    trampa esperando a que alguien lo encuentre y lo dé por bueno.
//
// La red de seguridad es `autorizacion-endpoints.spec.ts`, que falla si un endpoint exige un
// rol que no existe. Los nombres se escriben como cadena literal, exactamente como están en
// la base.

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

  /**
   * Capa de clientes del mapa de red. Separado de `mikrotik:view` a propósito.
   *
   * Es la única capa que expone PII —nombre y domicilio georreferenciado de cada
   * abonado— sobre un mapa navegable y con zoom. Un técnico de campo necesita ver la
   * planta (fibra, mufas, NAPs) para trabajar; no necesita el padrón completo ubicado
   * casa por casa. Compartir permiso con "ver routers" convertiría el mapa de red en un
   * directorio de domicilios para cualquiera con acceso a la sección.
   */
  MAPA_CLIENTES   = 'red:mapa:clientes',

  // Monitoreo
  MONITORING_VIEW = 'monitoring:view',

  // Tickets
  TICKETS_VIEW    = 'tickets:view',
  TICKETS_CREATE  = 'tickets:create',
  TICKETS_MANAGE  = 'tickets:manage',

  // Reportes
  REPORTS_VIEW    = 'reports:view',
  REPORTS_EXPORT  = 'reports:export',

  // Mensajería Masiva
  MENSAJERIA_MASIVA = 'mensajeria:masiva',

  // Administración
  USERS_MANAGE    = 'users:manage',
  ROLES_MANAGE    = 'roles:manage',
  SYSTEM_CONFIG   = 'system:config',
}
