import {
  Controller, Post, Get, Patch, Body, Req,
  UseGuards, HttpCode, HttpStatus, Headers,
  Logger,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiResponse, ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';

import { AuthService } from './auth.service';
import { AuditoriaService } from './auditoria.service';
import {
  LoginDto, RefreshTokenDto, ChangePasswordDto,
  ForgotPasswordDto, ResetPasswordDto, AuthResponseDto,
} from './dto/auth.dto';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { Public } from '../../common/decorators/public.decorator';
import {
  CurrentUser, JwtPayload,
} from '../../common/decorators/current-user.decorator';
import { ExtractJwt } from 'passport-jwt';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ── POST /api/v1/auth/login ───────────────────────────────
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  // Rate limiting estricto en login: 5 intentos por minuto por IP
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Iniciar sesión',
    description: 'Retorna access token (15min) y refresh token (7 días). ' +
      'La cuenta se bloquea por 30 min tras 5 intentos fallidos.',
  })
  @ApiResponse({ status: 200, type: AuthResponseDto, description: 'Login exitoso' })
  @ApiResponse({ status: 401, description: 'Credenciales inválidas' })
  @ApiResponse({ status: 403, description: 'Cuenta bloqueada o inactiva' })
  @ApiResponse({ status: 429, description: 'Demasiados intentos — espera 1 minuto' })
  async login(@Body() dto: LoginDto, @Req() req: Request): Promise<AuthResponseDto> {
    return this.authService.login(dto, req);
  }

  // ── POST /api/v1/auth/refresh ─────────────────────────────
  @Public()
  @UseGuards(JwtRefreshGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Renovar access token',
    description: 'Usa el refresh token para obtener un nuevo access token. ' +
      'Implementa rotación de tokens: el refresh token anterior queda inválido.',
  })
  @ApiBody({ type: RefreshTokenDto })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Refresh token inválido o expirado' })
  async refresh(@Req() req: Request & { user: any }): Promise<AuthResponseDto> {
    return this.authService.refresh(req.user, req);
  }

  // ── POST /api/v1/auth/logout ──────────────────────────────
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('JWT')
  @ApiOperation({
    summary: 'Cerrar sesión',
    description: 'Invalida el access token actual y elimina el refresh token. ' +
      'El token queda en blacklist hasta su expiración natural.',
  })
  @ApiResponse({ status: 204, description: 'Sesión cerrada correctamente' })
  async logout(
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ): Promise<void> {
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(req) || '';
    return this.authService.logout(user, token, req);
  }

  // ── GET /api/v1/auth/me ───────────────────────────────────
  @Get('me')
  @ApiBearerAuth('JWT')
  @ApiOperation({
    summary: 'Perfil del usuario autenticado',
    description: 'Retorna datos del usuario actual con sus roles y permisos.',
  })
  @ApiResponse({ status: 200, description: 'Datos del usuario actual' })
  async me(@CurrentUser() user: JwtPayload) {
    return this.authService.getMe(user.sub, user.empresaId);
  }

  // ── PATCH /api/v1/auth/change-password ───────────────────
  @Patch('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('JWT')
  @ApiOperation({
    summary: 'Cambiar contraseña',
    description: 'Requiere la contraseña actual. Al cambiar, cierra todas las sesiones activas.',
  })
  @ApiResponse({ status: 204, description: 'Contraseña cambiada — todas las sesiones cerradas' })
  @ApiResponse({ status: 400, description: 'Las contraseñas no coinciden o igual a la anterior' })
  @ApiResponse({ status: 401, description: 'Contraseña actual incorrecta' })
  async changePassword(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ): Promise<void> {
    return this.authService.cambiarPassword(user.sub, user.empresaId, dto, req);
  }

  // ── GET /api/v1/auth/permissions ─────────────────────────
  @Get('permissions')
  @ApiBearerAuth('JWT')
  @ApiOperation({
    summary: 'Permisos del usuario actual',
    description: 'Lista todos los permisos del usuario para que el frontend los cachee.',
  })
  async getPermissions(@CurrentUser() user: JwtPayload) {
    return {
      roles: user.roles,
      permisos: user.permisos,
      esAdmin: user.roles?.includes('Administrador') ?? false,
    };
  }

  // ── GET /api/v1/auth/audit ────────────────────────────────
  @Get('audit')
  @ApiBearerAuth('JWT')
  @ApiOperation({
    summary: 'Historial de accesos del usuario actual',
    description: 'Últimos 50 accesos del usuario autenticado.',
  })
  async getAudit(@CurrentUser() user: JwtPayload) {
    return this.auditoria.getHistorialUsuario(user.sub, user.empresaId);
  }

  // ── POST /api/v1/auth/forgot-password ─────────────────────
  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Solicitar recuperación de contraseña',
    description: 'Envía un email con enlace de recuperación válido 15 minutos. ' +
      'Siempre responde 204 para no revelar si el email existe.',
  })
  @ApiResponse({ status: 204, description: 'Solicitud procesada (email enviado si el usuario existe)' })
  @ApiResponse({ status: 429, description: 'Demasiadas solicitudes — espera 1 minuto' })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() req: Request,
  ): Promise<void> {
    return this.authService.forgotPassword(dto.email, req);
  }

  // ── POST /api/v1/auth/reset-password ──────────────────────
  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Restablecer contraseña con token',
    description: 'Valida el token del enlace de recuperación y establece la nueva contraseña. ' +
      'El token expira a los 15 minutos y se invalida tras el primer uso. ' +
      'Resetea intentos fallidos y desbloquea la cuenta.',
  })
  @ApiResponse({ status: 204, description: 'Contraseña restablecida exitosamente' })
  @ApiResponse({ status: 400, description: 'Token inválido o expirado' })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() req: Request,
  ): Promise<void> {
    return this.authService.resetPasswordViaToken(dto.token, dto.passwordNuevo, req);
  }
}
