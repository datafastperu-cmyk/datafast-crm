import {
  IsString, IsUUID, IsOptional, IsEnum, IsNumber,
  IsDateString, IsNotEmpty, Min, IsBoolean,
  IsArray, ValidateNested, IsInt, MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import { TipoComprobante, EstadoFactura, ItemFactura } from '../entities/factura.entity';
import { PaginationDto } from '../../../common/dto/response.dto';

// ─── Item ─────────────────────────────────────────────────────
export class ItemFacturaDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(300)
  descripcion: string;

  @ApiProperty({ example: 1 }) @IsNumber() @Min(0.001) @Type(() => Number)
  cantidad: number;

  @ApiProperty({ example: 85.00 }) @IsNumber() @Min(0) @Type(() => Number)
  precioUnitario: number;

  @ApiPropertyOptional({ example: 0 }) @IsOptional() @IsNumber() @Min(0) @Type(() => Number)
  descuento?: number;
}

// ─── Crear Factura manual ────────────────────────────────────
export class CreateFacturaDto {
  @ApiProperty() @IsUUID()
  clienteId: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  contratoId?: string;

  @ApiPropertyOptional({ enum: TipoComprobante, default: TipoComprobante.BOLETA })
  @IsOptional() @IsEnum(TipoComprobante)
  tipoComprobante?: TipoComprobante;

  @ApiProperty({ example: '2024-01-01' }) @IsDateString()
  periodoInicio: string;

  @ApiProperty({ example: '2024-01-31' }) @IsDateString()
  periodoFin: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500)
  descripcion?: string;

  @ApiPropertyOptional({ description: 'Items del comprobante. Si vacío, se toma el precio del contrato' })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ItemFacturaDto)
  items?: ItemFacturaDto[];

  @ApiPropertyOptional({ description: 'Monto base sin IGV. Si se proveen items se calcula automáticamente' })
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number)
  subtotal?: number;

  @ApiPropertyOptional({ example: 0 }) @IsOptional() @IsNumber() @Min(0) @Type(() => Number)
  descuento?: number;

  @ApiPropertyOptional({ description: 'Fecha de vencimiento. Por defecto: fechaEmision + días de gracia' })
  @IsOptional() @IsDateString()
  fechaVencimiento?: string;

  @ApiPropertyOptional({ example: true, description: 'Si aplica IGV 18%' })
  @IsOptional() @IsBoolean()
  aplicaIgv?: boolean;

  @ApiPropertyOptional({ example: 'PEN' }) @IsOptional() @IsString()
  moneda?: string;
}

// ─── Generar facturas mensuales masivas (admin) ──────────────
export class GenerarFacturasMensualesDto {
  @ApiPropertyOptional({ example: 2024 }) @IsOptional() @IsInt() @Type(() => Number)
  anio?: number;

  @ApiPropertyOptional({ example: 1 }) @IsOptional() @IsInt() @Min(1) @Type(() => Number)
  mes?: number;

  @ApiPropertyOptional({ description: 'Solo para un contrato específico (testing)' })
  @IsOptional() @IsUUID()
  contratoId?: string;

  @ApiPropertyOptional({ default: TipoComprobante.BOLETA })
  @IsOptional() @IsEnum(TipoComprobante)
  tipoComprobante?: TipoComprobante;
}

// ─── Nota de crédito ─────────────────────────────────────────
export class CreateNotaCreditoDto {
  @ApiProperty({ description: 'UUID de la factura original a anular/rectificar' })
  @IsUUID() @IsNotEmpty()
  facturaOriginalId: string;

  @ApiProperty({ example: 'Error en el monto facturado' })
  @IsString() @IsNotEmpty() @MaxLength(500)
  motivo: string;

  @ApiPropertyOptional({ description: 'Monto a acreditar. Si omitido = total de la factura original' })
  @IsOptional() @IsNumber() @Min(0.01) @Type(() => Number)
  montoAcreditar?: number;
}

// ─── Actualizar factura ──────────────────────────────────────
export class UpdateFacturaDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID()
  contratoId?: string;

  @ApiPropertyOptional({ enum: TipoComprobante })
  @IsOptional() @IsEnum(TipoComprobante)
  tipoComprobante?: TipoComprobante;

  @ApiPropertyOptional() @IsOptional() @IsDateString()
  periodoInicio?: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString()
  periodoFin?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500)
  descripcion?: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString()
  fechaVencimiento?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  aplicaIgv?: boolean;

  @ApiPropertyOptional()
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ItemFacturaDto)
  items?: ItemFacturaDto[];

  @ApiPropertyOptional({ description: 'Versión del registro para bloqueo optimista' })
  @IsOptional() @IsInt() @Min(1)
  version?: number;
}

// ─── Anular factura ──────────────────────────────────────────
export class AnularFacturaDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(500)
  motivo: string;

  @ApiPropertyOptional({ description: 'Crear nota de crédito automáticamente', default: true })
  @IsOptional() @IsBoolean()
  crearNotaCredito?: boolean;
}

// ─── Filtros ─────────────────────────────────────────────────
export class FilterFacturaDto extends PaginationDto {
  @ApiPropertyOptional({ enum: EstadoFactura })
  @IsOptional() @IsEnum(EstadoFactura)
  estado?: EstadoFactura;

  @ApiPropertyOptional({ enum: EstadoFactura, isArray: true })
  @IsOptional()
  @Transform(({ value }) => Array.isArray(value) ? value : [value])
  estados?: EstadoFactura[];

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  clienteId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  contratoId?: string;

  @ApiPropertyOptional({ enum: TipoComprobante })
  @IsOptional() @IsEnum(TipoComprobante)
  tipoComprobante?: TipoComprobante;

  @ApiPropertyOptional() @IsOptional() @IsString()
  serie?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  fechaDesde?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  fechaHasta?: string;

  @ApiPropertyOptional({ description: 'Solo facturas vencidas' })
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  vencidas?: boolean;

  @ApiPropertyOptional({ description: 'Solo generadas automáticamente' })
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  automatica?: boolean;
}

// ─── Resumen financiero (dashboard) ─────────────────────────
export class ResumenFinancieroDto {
  facturadoMes: number;
  cobradoMes: number;
  cobradoHoy: number;
  cobradoMesAnterior: number;
  cuentasPorCobrar: number;
  facturasVencidas: number;
  totalEmitidas: number;
  totalPagadas: number;
  totalAnuladas: number;
  tasaCobranza: number; // % cobrado del total facturado
}
