import {
  IsString, IsNotEmpty, IsOptional, MaxLength, IsIn, IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CrearVpnClienteDto {
  @ApiProperty({ example: 'Router Castilla Norte' })
  @IsString() @IsNotEmpty() @MaxLength(100)
  nombre: string;

  @ApiPropertyOptional({ example: 'Piura - Zona Norte' })
  @IsOptional() @IsString() @MaxLength(200)
  ubicacion?: string;

  @ApiPropertyOptional({ example: 'Router principal sector norte' })
  @IsOptional() @IsString()
  descripcion?: string;

  @ApiProperty({ example: 'v7', enum: ['v6', 'v7'] })
  @IsIn(['v6', 'v7'])
  versionRos: 'v6' | 'v7';

  @ApiPropertyOptional({ example: true })
  @IsOptional() @IsBoolean()
  usarCertificados?: boolean;

  @ApiPropertyOptional({ example: 'router-norte' })
  @IsOptional() @IsString() @MaxLength(100)
  vpnUsuario?: string;

  @ApiPropertyOptional({ example: 'P@ssw0rd123' })
  @IsOptional() @IsString() @MaxLength(200)
  vpnPassword?: string;

  @ApiPropertyOptional({ example: 'aes256', enum: ['aes128', 'aes192', 'aes256', 'blowfish128', 'aes128-gcm', 'aes256-gcm'] })
  @IsOptional() @IsIn(['aes128', 'aes192', 'aes256', 'blowfish128', 'aes128-gcm', 'aes256-gcm'])
  cipher?: string;

  @ApiPropertyOptional({ example: 'sha256', enum: ['md5', 'sha1', 'sha256', 'sha512'] })
  @IsOptional() @IsIn(['md5', 'sha1', 'sha256', 'sha512'])
  authAlg?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional() @IsBoolean()
  verifyServerCert?: boolean;
}
