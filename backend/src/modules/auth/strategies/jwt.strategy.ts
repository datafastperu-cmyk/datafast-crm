import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { Usuario, EstadoUsuario } from '../../usuarios/entities/usuario.entity';
import { JwtPayload } from '../../../common/decorators/current-user.decorator';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    @Inject(CACHE_MANAGER)
    private readonly cache: Cache,
  ) {
    super({
      // Extraer token del header Authorization: Bearer <token>
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.secret'),
      // Pasar el request completo para poder acceder al token raw
      passReqToCallback: true,
      issuer: 'datafast-crm',
      audience: 'datafast-app',
    });
  }

  async validate(req: Request, payload: JwtPayload): Promise<JwtPayload> {
    const { sub: userId, empresaId } = payload;

    // ── 1. Verificar blacklist de tokens (logout) ──────────────
    // Extraer el token del header para generar su clave en Redis
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
    const blacklistKey = `jwt_bl:${token?.substring(0, 32)}`;
    const isBlacklisted = await this.cache.get(blacklistKey);
    if (isBlacklisted) {
      throw new UnauthorizedException('Token invalidado — inicia sesión nuevamente');
    }

    // ── 2. Cache del usuario para evitar consultas BD en cada req ─
    const cacheKey = `user_session:${userId}`;
    const cached = await this.cache.get<JwtPayload>(cacheKey);
    if (cached) return cached;

    // ── 3. Verificar que el usuario existe y está activo ──────
    const usuario = await this.usuarioRepo.findOne({
      where: { id: userId, empresaId },
      relations: ['roles', 'roles.permisos'],
    });

    if (!usuario) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    if (usuario.estado !== EstadoUsuario.ACTIVO) {
      throw new UnauthorizedException(
        `Cuenta ${usuario.estado} — contacta al administrador`,
      );
    }

    if (usuario.estaBloqueado) {
      const hasta = usuario.bloqueadoHasta
        ? ` hasta ${usuario.bloqueadoHasta.toLocaleString('es-PE')}`
        : '';
      throw new UnauthorizedException(`Cuenta bloqueada${hasta}`);
    }

    // ── 4. Construir payload enriquecido ──────────────────────
    const enrichedPayload: JwtPayload = {
      sub: usuario.id,
      email: usuario.email,
      empresaId: usuario.empresaId,
      nombreCompleto: usuario.nombreCompleto,
      roles: usuario.nombresRoles,
      permisos: usuario.permisos,
      tema: usuario.tema,
    };

    // ── 5. Guardar en cache por 5 minutos ─────────────────────
    // Si el admin cambia roles del usuario, el cambio surte efecto
    // máximo en 5 minutos sin necesidad de invalidar el token.
    await this.cache.set(cacheKey, enrichedPayload, 300_000); // 5 min en ms

    return enrichedPayload;
  }
}
