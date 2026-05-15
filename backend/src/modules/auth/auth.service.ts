import {
  Injectable, UnauthorizedException, ForbiddenException,
  BadRequestException, NotFoundException, Logger,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import * as bcrypt from 'bcryptjs';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';

import { Usuario, EstadoUsuario } from '../usuarios/entities/usuario.entity';
import { AuditoriaService } from './auditoria.service';
import { LoginDto, ChangePasswordDto, AuthResponseDto } from './dto/auth.dto';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { generateToken } from '../../common/utils/encryption.util';

// Máximo de intentos fallidos antes de bloquear la cuenta
const MAX_INTENTOS_FALLIDOS = 5;
// Minutos de bloqueo tras agotar intentos
const MINUTOS_BLOQUEO = 30;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly auditoria: AuditoriaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  // ────────────────────────────────────────────────────────────
  // LOGIN
  // ────────────────────────────────────────────────────────────
  async login(dto: LoginDto, req: Request): Promise<AuthResponseDto> {
    const { email, password, deviceInfo } = dto;

    // ── 1. Buscar usuario ────────────────────────────────────
    const usuario = await this.usuarioRepo.findOne({
      where: { email: email.toLowerCase() },
      relations: ['roles', 'roles.permisos'],
    });

    // ── 2. Verificar existencia (mismo mensaje para no revelar emails) ─
    if (!usuario) {
      await this.auditoria.logLogin({
        usuarioEmail: email,
        descripcion: `Intento de login con email no registrado: ${email}`,
        exitoso: false,
        req,
      });
      throw new UnauthorizedException('Email o contraseña incorrectos');
    }

    // ── 3. Verificar estado ──────────────────────────────────
    if (usuario.estado === EstadoUsuario.INACTIVO) {
      throw new ForbiddenException('Cuenta desactivada — contacta al administrador');
    }

    if (usuario.estado === EstadoUsuario.PENDIENTE_VERIFICACION) {
      throw new ForbiddenException('Debes verificar tu email antes de iniciar sesión');
    }

    // ── 4. Verificar bloqueo temporal ────────────────────────
    if (usuario.estaBloqueado) {
      const hasta = usuario.bloqueadoHasta
        ? `hasta ${usuario.bloqueadoHasta.toLocaleString('es-PE', { timeZone: 'America/Lima' })}`
        : 'temporalmente';
      throw new ForbiddenException(`Cuenta bloqueada ${hasta} por múltiples intentos fallidos`);
    }

    // ── 5. Verificar contraseña ──────────────────────────────
    const passwordValido = await bcrypt.compare(password, usuario.passwordHash);

    if (!passwordValido) {
      await this.handleIntentoFallido(usuario, req, email);
    }

    // ── 6. Login exitoso — resetear intentos fallidos ────────
    if (usuario.intentosFallidos > 0) {
      await this.usuarioRepo.update(usuario.id, {
        intentosFallidos: 0,
        bloqueadoHasta: null,
      });
    }

    // ── 7. Generar tokens ────────────────────────────────────
    const { accessToken, refreshToken, expiresIn } =
      await this.generarTokens(usuario);

    // ── 8. Guardar hash del refresh token ────────────────────
    const refreshHash = await bcrypt.hash(refreshToken, 10);
    await this.usuarioRepo.update(usuario.id, {
      refreshTokenHash: refreshHash,
      ultimoAcceso: new Date(),
    });

    // ── 9. Invalidar cache del usuario (forzar reload) ───────
    await this.cache.del(`user_session:${usuario.id}`);

    // ── 10. Auditoría ────────────────────────────────────────
    await this.auditoria.logLogin({
      empresaId: usuario.empresaId,
      usuarioId: usuario.id,
      usuarioEmail: usuario.email,
      descripcion: `Login exitoso${deviceInfo ? ` desde ${deviceInfo}` : ''}`,
      exitoso: true,
      req,
    });

    this.logger.log(
      `Login: ${usuario.email} | empresa: ${usuario.empresaId} | ip: ${req.ip}`,
    );

    return this.buildAuthResponse(usuario, accessToken, refreshToken, expiresIn);
  }

  // ────────────────────────────────────────────────────────────
  // REFRESH TOKEN
  // ────────────────────────────────────────────────────────────
  async refresh(usuario: Usuario, req: Request): Promise<AuthResponseDto> {
    // Generar nuevos tokens (rotación de refresh token)
    const { accessToken, refreshToken, expiresIn } =
      await this.generarTokens(usuario);

    // Actualizar hash del nuevo refresh token
    const refreshHash = await bcrypt.hash(refreshToken, 10);
    await this.usuarioRepo.update(usuario.id, {
      refreshTokenHash: refreshHash,
      ultimoAcceso: new Date(),
    });

    // Invalidar cache para forzar recarga de permisos
    await this.cache.del(`user_session:${usuario.id}`);

    this.logger.debug(`Token renovado: ${usuario.email}`);

    // Recargar con relaciones para el response
    const usuarioCompleto = await this.usuarioRepo.findOne({
      where: { id: usuario.id },
      relations: ['roles', 'roles.permisos'],
    });

    return this.buildAuthResponse(usuarioCompleto, accessToken, refreshToken, expiresIn);
  }

  // ────────────────────────────────────────────────────────────
  // LOGOUT
  // ────────────────────────────────────────────────────────────
  async logout(usuario: JwtPayload, token: string, req: Request): Promise<void> {
    // Invalidar refresh token en BD
    await this.usuarioRepo.update(usuario.sub, { refreshTokenHash: null });

    // Agregar access token actual al blacklist en Redis
    // TTL = tiempo restante hasta expiración del token
    const payload = this.jwtService.decode(token) as any;
    if (payload?.exp) {
      const ttlMs = (payload.exp * 1000) - Date.now();
      if (ttlMs > 0) {
        await this.cache.set(
          `jwt_bl:${token.substring(0, 32)}`,
          true,
          ttlMs,
        );
      }
    }

    // Invalidar cache de sesión
    await this.cache.del(`user_session:${usuario.sub}`);

    await this.auditoria.logLogout({
      empresaId: usuario.empresaId,
      usuarioId: usuario.sub,
      usuarioEmail: usuario.email,
      descripcion: 'Logout exitoso',
      req,
    });

    this.logger.log(`Logout: ${usuario.email}`);
  }

  // ────────────────────────────────────────────────────────────
  // CAMBIAR CONTRASEÑA
  // ────────────────────────────────────────────────────────────
  async cambiarPassword(
    usuarioId: string,
    empresaId: string,
    dto: ChangePasswordDto,
    req: Request,
  ): Promise<void> {
    if (dto.passwordNuevo !== dto.confirmarPassword) {
      throw new BadRequestException('Las contraseñas no coinciden');
    }

    const usuario = await this.usuarioRepo.findOne({
      where: { id: usuarioId, empresaId },
    });

    if (!usuario) throw new NotFoundException('Usuario no encontrado');

    const actual = await bcrypt.compare(dto.passwordActual, usuario.passwordHash);
    if (!actual) {
      throw new UnauthorizedException('La contraseña actual es incorrecta');
    }

    if (dto.passwordActual === dto.passwordNuevo) {
      throw new BadRequestException('La nueva contraseña debe ser diferente a la actual');
    }

    const nuevoHash = await bcrypt.hash(dto.passwordNuevo, 12);
    await this.usuarioRepo.update(usuarioId, {
      passwordHash: nuevoHash,
      refreshTokenHash: null, // cerrar todas las sesiones
    });

    // Invalidar cache
    await this.cache.del(`user_session:${usuarioId}`);

    await this.auditoria.log({
      empresaId,
      usuarioId,
      usuarioEmail: usuario.email,
      accion: 'CHANGE_PASSWORD',
      modulo: 'auth',
      descripcion: 'Cambio de contraseña exitoso',
      req,
    });
  }

  // ────────────────────────────────────────────────────────────
  // ME — Perfil del usuario actual
  // ────────────────────────────────────────────────────────────
  async getMe(usuarioId: string, empresaId: string): Promise<Usuario> {
    const usuario = await this.usuarioRepo.findOne({
      where: { id: usuarioId, empresaId },
      relations: ['roles', 'roles.permisos'],
    });

    if (!usuario) throw new NotFoundException('Usuario no encontrado');
    return usuario;
  }

  // ────────────────────────────────────────────────────────────
  // HELPERS PRIVADOS
  // ────────────────────────────────────────────────────────────

  private async generarTokens(usuario: Usuario) {
    const jwtSecret = this.config.get<string>('jwt.secret');
    const jwtRefreshSecret = this.config.get<string>('jwt.refreshSecret');
    const expiresIn = this.config.get<string>('jwt.expiresIn', '15m');
    const refreshExpiresIn = this.config.get<string>('jwt.refreshExpiresIn', '7d');

    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: usuario.id,
      email: usuario.email,
      empresaId: usuario.empresaId,
      nombreCompleto: usuario.nombreCompleto,
      roles: usuario.nombresRoles,
      permisos: usuario.permisos,
      tema: usuario.tema,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: jwtSecret,
        expiresIn,
        issuer: 'datafast-crm',
        audience: 'datafast-app',
      }),
      this.jwtService.signAsync(
        { sub: usuario.id },  // Refresh token lleva solo el ID (mínimo)
        {
          secret: jwtRefreshSecret,
          expiresIn: refreshExpiresIn,
          issuer: 'datafast-crm',
          audience: 'datafast-app',
        },
      ),
    ]);

    // Calcular segundos hasta expiración del access token
    const expiresInSeconds = this.parseDuration(expiresIn);

    return { accessToken, refreshToken, expiresIn: expiresInSeconds };
  }

  private buildAuthResponse(
    usuario: Usuario,
    accessToken: string,
    refreshToken: string,
    expiresIn: number,
  ): AuthResponseDto {
    return {
      accessToken,
      refreshToken,
      expiresIn,
      tokenType: 'Bearer',
      usuario: {
        id: usuario.id,
        nombreCompleto: usuario.nombreCompleto,
        email: usuario.email,
        fotoUrl: usuario.fotoUrl,
        empresaId: usuario.empresaId,
        roles: usuario.nombresRoles,
        permisos: usuario.permisos,
        tema: usuario.tema,
      },
    };
  }

  private async handleIntentoFallido(
    usuario: Usuario,
    req: Request,
    email: string,
  ): Promise<never> {
    const nuevosIntentos = usuario.intentosFallidos + 1;
    const updates: Partial<Usuario> = { intentosFallidos: nuevosIntentos };

    if (nuevosIntentos >= MAX_INTENTOS_FALLIDOS) {
      const bloqueadoHasta = new Date(
        Date.now() + MINUTOS_BLOQUEO * 60 * 1000,
      );
      updates.bloqueadoHasta = bloqueadoHasta;
      updates.estado = EstadoUsuario.BLOQUEADO;

      this.logger.warn(
        `Cuenta bloqueada: ${email} tras ${nuevosIntentos} intentos fallidos | ip: ${req.ip}`,
      );
    }

    await this.usuarioRepo.update(usuario.id, updates);

    await this.auditoria.logLogin({
      empresaId: usuario.empresaId,
      usuarioId: usuario.id,
      usuarioEmail: email,
      descripcion: `Intento fallido ${nuevosIntentos}/${MAX_INTENTOS_FALLIDOS}`,
      exitoso: false,
      req,
    });

    const restantes = MAX_INTENTOS_FALLIDOS - nuevosIntentos;
    const mensaje =
      restantes > 0
        ? `Email o contraseña incorrectos. ${restantes} intento(s) restante(s)`
        : `Cuenta bloqueada por ${MINUTOS_BLOQUEO} minutos por múltiples intentos fallidos`;

    throw new UnauthorizedException(mensaje);
  }

  // Parsear duración tipo '15m', '7d', '1h' a segundos
  private parseDuration(duration: string): number {
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) return 900; // 15 min default
    const value = parseInt(match[1]);
    const unit = match[2];
    const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
    return value * (multipliers[unit] || 60);
  }
}
