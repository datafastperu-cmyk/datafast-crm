import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// ─── Payload completo del JWT ─────────────────────────────────
export interface JwtPayload {
  sub: string;            // usuario ID (UUID)
  email: string;
  empresaId: string;
  nombreCompleto: string;
  roles: string[];        // ['Administrador', 'Cajero']
  permisos: string[];     // ['clientes:create', 'pagos:view', ...]
  tema: string;
  iat?: number;
  exp?: number;
}

// ─── @CurrentUser() — extrae el usuario del request ──────────
// Uso: @CurrentUser() user: JwtPayload
// Uso: @CurrentUser('sub') userId: string
export const CurrentUser = createParamDecorator(
  (field: keyof JwtPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user: JwtPayload = request.user;
    if (!user) return null;
    return field ? user[field] : user;
  },
);

// ─── Shortcuts ────────────────────────────────────────────────
export const CurrentUserId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string =>
    ctx.switchToHttp().getRequest().user?.sub,
);

export const CurrentEmpresaId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string =>
    ctx.switchToHttp().getRequest().user?.empresaId,
);
