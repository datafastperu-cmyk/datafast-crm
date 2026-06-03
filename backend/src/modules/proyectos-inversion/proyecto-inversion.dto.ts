import {
  IsDateString, IsEnum, IsNotEmpty, IsNumber,
  IsOptional, IsPositive, IsString, IsUUID,
  Max, MaxLength, Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EstadoProyecto } from './proyecto-inversion.entity';
import { PaginationDto } from '../../common/dto/response.dto';

export class CreateProyectoInversionDto {
  @ApiProperty({ example: 'Expansión Zona Norte – Fibra FTTH' })
  @IsString() @IsNotEmpty() @MaxLength(200)
  nombreProyecto: string;

  @ApiProperty({ description: 'UUID de la zona/sector geográfico' })
  @IsUUID('4')
  sectorId: string;

  @ApiProperty({ example: 45000, description: 'CapEx total en PEN' })
  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  inversionInicial: number;

  @ApiProperty({ example: 0.10, description: 'Tasa de descuento anual (0.10 = 10 %)' })
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.001) @Max(0.99)
  tasaDescuento: number;

  @ApiProperty({ example: '2026-01-01' })
  @IsDateString()
  fechaInicio: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional() @IsString() @MaxLength(500)
  descripcion?: string;
}

export class UpdateProyectoInversionDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  nombreProyecto?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  inversionInicial?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.001) @Max(0.99)
  tasaDescuento?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsDateString()
  fechaInicio?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(500)
  descripcion?: string;

  @ApiPropertyOptional({ enum: EstadoProyecto })
  @IsOptional() @IsEnum(EstadoProyecto)
  estado?: EstadoProyecto;
}

export class FilterProyectoInversionDto extends PaginationDto {
  @ApiPropertyOptional({ enum: EstadoProyecto })
  @IsOptional() @IsEnum(EstadoProyecto)
  estado?: EstadoProyecto;

  @ApiPropertyOptional()
  @IsOptional() @IsUUID()
  sectorId?: string;
}

// ─── Respuesta de ratios financieros ─────────────────────────
export interface RatiosFinancierosResult {
  proyectoId:       string;
  nombreProyecto:   string;
  sectorId:         string;
  inversionInicial: number;
  tasaDescuento:    number;
  fechaInicio:      string;
  mesesEvaluados:   number;
  flujosMensuales:  number[];
  van:              number;
  tir:              number | null;
  paybackMeses:     number | null;
}
