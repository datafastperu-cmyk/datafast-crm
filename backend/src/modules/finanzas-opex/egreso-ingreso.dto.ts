import {
  IsBoolean, IsDateString, IsEnum, IsNotEmpty, IsNumber,
  IsOptional, IsPositive, IsString, IsUUID, Max, MaxLength, Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TipoMovimiento, CategoriaMovimiento, EstadoMovimiento } from './egreso-ingreso.entity';
import { PaginationDto } from '../../common/dto/response.dto';

export class CreateEgresoIngresoDto {
  @ApiProperty({ enum: TipoMovimiento })
  @IsEnum(TipoMovimiento)
  tipo: TipoMovimiento;

  @ApiPropertyOptional({ enum: CategoriaMovimiento, default: CategoriaMovimiento.OTROS })
  @IsOptional() @IsEnum(CategoriaMovimiento)
  categoria?: CategoriaMovimiento;

  @ApiProperty({ example: 250.00 })
  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  monto: number;

  @ApiProperty({ example: '2026-06-01' })
  @IsDateString()
  fechaRegistro: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional() @IsString() @MaxLength(500)
  descripcion?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional() @IsBoolean()
  esRecurrente?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 31, description: 'Requerido si esRecurrente = true' })
  @IsOptional() @IsNumber() @Min(1) @Max(31)
  diaVencimiento?: number;

  @ApiPropertyOptional({ description: 'UUID de la zona geográfica a la que se asigna este egreso' })
  @IsOptional() @IsUUID()
  sectorId?: string;
}

export class UpdateEgresoIngresoDto {
  @ApiPropertyOptional({ enum: CategoriaMovimiento })
  @IsOptional() @IsEnum(CategoriaMovimiento)
  categoria?: CategoriaMovimiento;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  monto?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsDateString()
  fechaRegistro?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(500)
  descripcion?: string;

  @ApiPropertyOptional({ enum: EstadoMovimiento })
  @IsOptional() @IsEnum(EstadoMovimiento)
  estado?: EstadoMovimiento;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  esRecurrente?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 31 })
  @IsOptional() @IsNumber() @Min(1) @Max(31)
  diaVencimiento?: number;
}

export class FilterEgresoIngresoDto extends PaginationDto {
  @ApiPropertyOptional({ enum: TipoMovimiento })
  @IsOptional() @IsEnum(TipoMovimiento)
  tipo?: TipoMovimiento;

  @ApiPropertyOptional({ enum: CategoriaMovimiento })
  @IsOptional() @IsEnum(CategoriaMovimiento)
  categoria?: CategoriaMovimiento;

  @ApiPropertyOptional({ enum: EstadoMovimiento })
  @IsOptional() @IsEnum(EstadoMovimiento)
  estado?: EstadoMovimiento;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  fechaDesde?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  fechaHasta?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : undefined)
  @IsBoolean()
  soloRecurrentes?: boolean;
}
