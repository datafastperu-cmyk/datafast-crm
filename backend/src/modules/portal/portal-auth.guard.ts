import {
  Injectable, CanActivate, ExecutionContext,
  UnauthorizedException, createParamDecorator,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

export const PORTAL_JWT_ISSUER   = 'datafast-crm';
export const PORTAL_JWT_AUDIENCE = 'datafast-portal';

export const COOKIE_ACCESS  = 'portal_access_token';
export const COOKIE_REFRESH = 'portal_refresh_token';

// El abonado NO es un usuario del ERP: no tiene roles ni permisos internos.
// `sub` es el cliente, nunca un `usuarios.id`.
export interface PortalJwtPayload {
  sub:        string;   // clientes.id
  empresaId:  string;
  usuario:    string;   // clientes.usuario_portal
  tipo:       'access' | 'refresh';
  iat?:       number;
  exp?:       number;
}

// Lectura de cookies sin cookie-parser: el proyecto no lo tiene instalado y añadir
// una dependencia para partir una cabecera no se justifica.
export function leerCookie(req: Request, nombre: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const parte of raw.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    if (parte.slice(0, i).trim() === nombre) {
      return decodeURIComponent(parte.slice(i + 1).trim());
    }
  }
  return null;
}

// Guard exclusivo del portal del abonado.
//
// La separación con el ERP es estructural, no una convención: el token del portal
// lleva `aud: datafast-portal` y la estrategia interna exige `aud: datafast-app`, así
// que un token de abonado no pasa ningún guard interno aunque llegue a un endpoint
// del ERP, y un token de operador no pasa por aquí.
@Injectable()
export class PortalJwtGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();

    const cookie = leerCookie(req, COOKIE_ACCESS);
    const header = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null;
    const token = cookie ?? header;

    if (!token) throw new UnauthorizedException('Inicia sesión para continuar');

    // El secreto se pasa explícito en cada verificación: el JwtModule del portal se
    // registra sin secreto por defecto para que ningún token de abonado pueda acabar
    // validado —ni firmado— con el secreto del ERP.
    const secreto = (process.env.PORTAL_JWT_SECRET || '').trim();
    if (secreto.length < 32) {
      throw new UnauthorizedException('El portal no está configurado en este servidor');
    }

    let payload: PortalJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<PortalJwtPayload>(token, {
        secret:   secreto,
        issuer:   PORTAL_JWT_ISSUER,
        audience: PORTAL_JWT_AUDIENCE,
      });
    } catch {
      throw new UnauthorizedException('Tu sesión expiró. Vuelve a iniciar sesión.');
    }

    // Un refresh token no habilita el acceso a los datos: solo sirve para renovar.
    if (payload.tipo !== 'access') {
      throw new UnauthorizedException('Token no válido para esta operación');
    }

    (req as Request & { portalCliente?: PortalJwtPayload }).portalCliente = payload;
    return true;
  }
}

// @ClientePortal() — el abonado autenticado del request.
export const ClientePortal = createParamDecorator(
  (campo: keyof PortalJwtPayload | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<
      Request & { portalCliente?: PortalJwtPayload }
    >();
    const cliente = req.portalCliente;
    if (!cliente) return null;
    return campo ? cliente[campo] : cliente;
  },
);
