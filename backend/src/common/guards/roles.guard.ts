import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, PERMISSIONS_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Obtener roles y permisos requeridos del endpoint
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Si no requiere roles ni permisos, permitir
    if (!requiredRoles?.length && !requiredPermissions?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Usuario no autenticado');
    }

    const userRoles: string[] = user.roles || [];
    const userPermissions: string[] = user.permisos || [];

    // Aquí había un bypass: `if (userRoles.includes('admin')) return true;`
    //
    // **Era código muerto.** Verificado contra la base de producción el 2026-08-08: no existe
    // ningún rol llamado `admin`. Los diez reales son `Administrador`, `Super Administrador`,
    // `Supervisor`, `Cajero`, `Vendedor`, `Técnico`, `Atención al Cliente`, `Cobranza`,
    // `Operador NOC` e `Invitado`. La condición nunca se cumplía.
    //
    // **Se BORRA, no se corrige.** Cambiarlo a `'Administrador'` parece el arreglo obvio y
    // sería una regresión de seguridad: le daría a ese rol un bypass sobre TODOS los permisos
    // finos, incluidos los 143 endpoints que hoy sí los comprueban uno a uno. Un rol con
    // acceso total se concede asignándole los permisos, no saltándose el guard.
    //
    // Si alguien necesita un rol que lo pueda todo, la vía es `roles_permisos`, que además
    // deja constancia de qué se le concedió y cuándo.

    // Verificar roles
    if (requiredRoles?.length) {
      const hasRole = requiredRoles.some((role) => userRoles.includes(role));
      if (!hasRole) {
        this.logger.warn(
          `Acceso denegado: usuario ${user.sub} con roles [${userRoles}] intentó acceder a ruta que requiere [${requiredRoles}]`,
        );
        throw new ForbiddenException(
          `Acceso denegado — se requiere uno de estos roles: ${requiredRoles.join(', ')}`,
        );
      }
    }

    // Verificar permisos granulares
    if (requiredPermissions?.length) {
      const hasPermission = requiredPermissions.every((perm) =>
        userPermissions.includes(perm),
      );
      if (!hasPermission) {
        this.logger.warn(
          `Acceso denegado: usuario ${user.sub} sin permisos [${requiredPermissions}]`,
        );
        throw new ForbiddenException(
          `Acceso denegado — sin permiso para realizar esta acción`,
        );
      }
    }

    return true;
  }
}
