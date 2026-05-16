import {
  IsString, IsNotEmpty, IsOptional, MaxLength, IsIn,
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
}
