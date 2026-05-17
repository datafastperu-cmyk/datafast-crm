import {
  IsString, IsNotEmpty, IsOptional, IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class CreateRolDto {
  @ApiProperty({ example: 'Asesor Comercial' })
  @IsString() @IsNotEmpty()
  nombre: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  descripcion?: string;

  @ApiPropertyOptional({ example: ['clientes:view', 'contratos:create'] })
  @IsOptional() @IsArray() @IsString({ each: true })
  permisosCodigos?: string[];
}

export class UpdateRolDto extends PartialType(CreateRolDto) {}

export class AsignarPermisosDto {
  @ApiProperty({ example: ['clientes:view', 'pagos:create'] })
  @IsArray() @IsString({ each: true })
  permisosCodigos: string[];
}
