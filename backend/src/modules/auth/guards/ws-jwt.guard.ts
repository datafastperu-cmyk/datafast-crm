import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';

// ─── Guard JWT para conexiones WebSocket (Socket.IO) ──────────
// El cliente debe enviar el JWT en el handshake:
//   socket = io(url, { auth: { token: 'Bearer xxx' } })
//   o en: extraHeaders: { Authorization: 'Bearer xxx' }
@Injectable()
export class WsJwtGuard implements CanActivate {
  private readonly logger = new Logger(WsJwtGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client: Socket = context.switchToWs().getClient();

    try {
      const token = this.extractToken(client);
      if (!token) throw new WsException('Token no proporcionado');

      // Verificar blacklist
      const blacklistKey = `jwt_bl:${token.substring(0, 32)}`;
      if (await this.cache.get(blacklistKey)) {
        throw new WsException('Token invalidado');
      }

      const payload = this.jwtService.verify(token, {
        secret: this.config.get('jwt.secret'),
        issuer: 'datafast-crm',
        audience: 'datafast-app',
      });

      // Adjuntar usuario al socket para uso posterior
      (client as any).user = payload;
      // Unir al room de su empresa (para broadcasts por empresa)
      client.join(`empresa:${payload.empresaId}`);

      return true;
    } catch (err) {
      this.logger.warn(`WS auth failed: ${err.message} | socket: ${client.id}`);
      client.emit('error', { message: 'No autorizado', code: 'WS_UNAUTHORIZED' });
      client.disconnect(true);
      return false;
    }
  }

  private extractToken(client: Socket): string | null {
    // Opción 1: auth.token del handshake
    const authToken = client.handshake?.auth?.token as string;
    if (authToken) return authToken.replace(/^Bearer\s+/i, '');

    // Opción 2: Authorization header del handshake
    const header = client.handshake?.headers?.authorization as string;
    if (header) return header.replace(/^Bearer\s+/i, '');

    // Opción 3: query param (menos seguro, solo para dev)
    const query = client.handshake?.query?.token as string;
    if (query) return query;

    return null;
  }
}
