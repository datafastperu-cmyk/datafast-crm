export declare const ROLES_KEY = "roles";
export declare const PERMISSIONS_KEY = "permissions";
export declare const Roles: (...roles: string[]) => import("@nestjs/common").CustomDecorator<string>;
export declare const RequirePermission: (...permissions: string[]) => import("@nestjs/common").CustomDecorator<string>;
export declare enum Role {
    ADMIN = "admin",
    SUPERVISOR = "supervisor",
    VENDEDOR = "vendedor",
    CAJERO = "cajero",
    TECNICO = "tecnico",
    CLIENTE = "cliente"
}
export declare enum Permission {
    CLIENTES_VIEW = "clientes:view",
    CLIENTES_CREATE = "clientes:create",
    CLIENTES_EDIT = "clientes:edit",
    CLIENTES_DELETE = "clientes:delete",
    FACTURAS_VIEW = "facturas:view",
    FACTURAS_CREATE = "facturas:create",
    FACTURAS_DELETE = "facturas:delete",
    PAGOS_VIEW = "pagos:view",
    PAGOS_CREATE = "pagos:create",
    PAGOS_VERIFY = "pagos:verify",
    MIKROTIK_VIEW = "mikrotik:view",
    MIKROTIK_MANAGE = "mikrotik:manage",
    ONU_PROVISION = "onu:provision",
    ONU_VIEW = "onu:view",
    MONITORING_VIEW = "monitoring:view",
    TICKETS_VIEW = "tickets:view",
    TICKETS_CREATE = "tickets:create",
    TICKETS_MANAGE = "tickets:manage",
    REPORTS_VIEW = "reports:view",
    REPORTS_EXPORT = "reports:export",
    USERS_MANAGE = "users:manage",
    ROLES_MANAGE = "roles:manage",
    SYSTEM_CONFIG = "system:config"
}
