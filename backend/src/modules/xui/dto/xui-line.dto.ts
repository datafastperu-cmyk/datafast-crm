import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class EditarXuiLineDto {
  @ApiPropertyOptional({ type: [Number] })
  @IsOptional() @IsArray() @IsInt({ each: true })
  bouquetIds?: number[];

  @ApiPropertyOptional()
  @IsOptional() @IsInt() @Min(1) @Max(50) @Type(() => Number)
  maxConexiones?: number;

  @ApiPropertyOptional({ description: 'Si es true, regenera usuario/contraseña desde el DNI del cliente' })
  @IsOptional()
  regenerarCredenciales?: boolean;
}

export class FilterXuiLineDto {
  @ApiPropertyOptional()
  @IsOptional() @IsUUID()
  clienteId?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsUUID()
  contratoId?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  q?: string;
}
