import {
  IsEmail, IsString, IsNotEmpty, MinLength,
  IsArray, IsOptional, IsEnum, IsUUID, ArrayMinSize,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';

export class CreateUsuarioDto {
  @ApiProperty({ example: 'Juan' })
  @IsString() @IsNotEmpty()
  nombres: string;

  @ApiProperty({ example: 'Pérez García' })
  @IsString() @IsNotEmpty()
  apellidos: string;

  @ApiProperty({ example: 'juan@datafast.pe' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Seguro@2024!' })
  @IsString() @MinLength(8)
  password: string;

  @ApiPropertyOptional({ example: '+51 987 654 321' })
  @IsOptional() @IsString()
  telefono?: string;

  @ApiProperty({ example: ['Técnico'] })
  @IsArray() @ArrayMinSize(1) @IsString({ each: true })
  roles: string[];
}

export class UpdateUsuarioDto extends PartialType(OmitType(CreateUsuarioDto, ['password'] as const)) {}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString() @MinLength(8)
  nuevaPassword: string;
}

export class EstadoUsuarioDto {
  @ApiProperty({ enum: ['activo', 'inactivo', 'bloqueado'] })
  @IsEnum(['activo', 'inactivo', 'bloqueado'])
  estado: string;
}

export class AsignarRolesDto {
  @ApiProperty({ example: ['Técnico', 'Cajero'] })
  @IsArray() @IsString({ each: true })
  roles: string[];
}
