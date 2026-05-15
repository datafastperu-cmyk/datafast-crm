import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import * as bcrypt from 'bcryptjs';
import { Usuario, EstadoUsuario } from '../../usuarios/entities/usuario.entity';

// ─── Estrategia exclusiva para el endpoint POST /auth/refresh ─
// Usa un secret DIFERENTE al access token para mayor seguridad.
// El refresh token viaja en el body, no en el header.
@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromBodyField('refreshToken'),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.refreshSecret'),
      passReqToCallback: true,
      issuer: 'datafast-crm',
      audience: 'datafast-app',
    });
  }

  async validate(req: Request, payload: any) {
    const { sub: userId } = payload;

    // Refresh token del body
    const refreshToken: string = req.body?.refreshToken;
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token no proporcionado');
    }

    const usuario = await this.usuarioRepo.findOne({
      where: { id: userId },
      relations: ['roles', 'roles.permisos'],
    });

    if (!usuario || !usuario.refreshTokenHash) {
      throw new UnauthorizedException('Sesión inválida — inicia sesión nuevamente');
    }

    if (usuario.estado !== EstadoUsuario.ACTIVO) {
      throw new UnauthorizedException('Cuenta inactiva');
    }

    // Verificar que el refresh token coincide con el hash guardado
    const tokenValido = await bcrypt.compare(refreshToken, usuario.refreshTokenHash);
    if (!tokenValido) {
      // Posible robo de token — invalida la sesión completamente
      await this.usuarioRepo.update(userId, { refreshTokenHash: null });
      throw new UnauthorizedException(
        'Refresh token inválido — sesión cerrada por seguridad',
      );
    }

    return usuario;
  }
}
