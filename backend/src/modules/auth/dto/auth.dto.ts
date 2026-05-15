import {
  IsEmail, IsString, MinLength, MaxLength,
  IsOptional, IsNotEmpty, Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

// ─── Login ───────────────────────────────────────────────────
export class LoginDto {
  @ApiProperty({ example: 'admin@datafast.pe' })
  @IsEmail({}, { message: 'Ingresa un email válido' })
  @Transform(({ value }) => value?.toLowerCase().trim())
  email: string;

  @ApiProperty({ example: 'Admin@DATAFAST2024!' })
  @IsString()
  @IsNotEmpty({ message: 'La contraseña es requerida' })
  @MinLength(6, { message: 'Mínimo 6 caracteres' })
  password: string;

  @ApiPropertyOptional({ description: 'Dispositivo del cliente para identificar la sesión' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  deviceInfo?: string;
}

// ─── Refresh Token ────────────────────────────────────────────
export class RefreshTokenDto {
  @ApiProperty({ description: 'Refresh token obtenido en el login' })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

// ─── Cambiar contraseña ───────────────────────────────────────
export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  passwordActual: string;

  @ApiProperty({ minLength: 8, description: 'Mínimo 8 chars, 1 mayúscula, 1 número, 1 especial' })
  @IsString()
  @MinLength(8, { message: 'Mínimo 8 caracteres' })
  @Matches(/^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&.#\-_])[A-Za-z\d@$!%*?&.#\-_]{8,}$/, {
    message: 'La contraseña debe tener al menos 1 mayúscula, 1 número y 1 carácter especial',
  })
  passwordNuevo: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  confirmarPassword: string;
}

// ─── Forgot Password ──────────────────────────────────────────
export class ForgotPasswordDto {
  @ApiProperty({ example: 'usuario@datafast.pe' })
  @IsEmail({}, { message: 'Email inválido' })
  @Transform(({ value }) => value?.toLowerCase().trim())
  email: string;
}

// ─── Reset Password ───────────────────────────────────────────
export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&.#\-_])[A-Za-z\d@$!%*?&.#\-_]{8,}$/, {
    message: 'La contraseña debe tener al menos 1 mayúscula, 1 número y 1 carácter especial',
  })
  passwordNuevo: string;
}

// ─── Respuesta de login (lo que devuelve la API) ──────────────
export class AuthResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty()
  refreshToken: string;

  @ApiProperty()
  expiresIn: number;  // segundos

  @ApiProperty()
  tokenType: string;  // 'Bearer'

  @ApiProperty()
  usuario: {
    id: string;
    nombreCompleto: string;
    email: string;
    fotoUrl: string | null;
    empresaId: string;
    roles: string[];
    permisos: string[];
    tema: string;
  };
}
