import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Guard específico para el endpoint POST /auth/refresh
// Usa la estrategia 'jwt-refresh' que valida el refreshToken del body
@Injectable()
export class JwtRefreshGuard extends AuthGuard('jwt-refresh') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }
}
