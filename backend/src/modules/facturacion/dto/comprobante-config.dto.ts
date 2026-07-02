import {
  IsString, IsBoolean, IsOptional, IsNotEmpty,
  MaxLength, MinLength, Matches, IsNumber, Min, Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';


export class CreateComprobanteConfigDto {
  @ApiProperty({ example: 'Factura', description: 'Nombre visible del tipo de comprobante' })
  @IsString() @IsNotEmpty() @MaxLength(100)
  nombre: string;

  @ApiProperty({ example: 'fac', description: 'Código único por empresa (sin espacios, minúsculas)' })
  @IsString() @IsNotEmpty() @MaxLength(30)
  @Matches(/^[a-z0-9_]+$/, { message: 'El código solo puede contener minúsculas, números y guiones bajos' })
  codigo: string;

  @ApiProperty({ example: true, description: 'Si este comprobante aplica IGV/IVA' })
  @IsBoolean()
  tieneCargaFiscal: boolean;

  @ApiProperty({ example: 'F001', description: 'Serie de numeración' })
  @IsString() @IsNotEmpty() @MinLength(1) @MaxLength(10)
  serie: string;

  @ApiPropertyOptional({ example: false, description: 'Si es el tipo por defecto de la empresa' })
  @IsOptional() @IsBoolean()
  esDefault?: boolean;
}

export class UpdateComprobanteConfigDto extends PartialType(CreateComprobanteConfigDto) {
  @ApiPropertyOptional({ example: true })
  @IsOptional() @IsBoolean()
  activo?: boolean;
}

export class UpdateConfiguracionFacturacionDto {
  @ApiPropertyOptional({ example: 'PEN' })
  @IsOptional() @IsString() @MaxLength(3)
  moneda?: string;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional() @IsString() @MaxLength(3)
  moneda2?: string;

  @ApiPropertyOptional({ example: 18, description: 'Tasa IGV/IVA en porcentaje entero (18 = 18%)' })
  @IsOptional() @IsNumber() @Min(0) @Max(100) @Type(() => Number)
  igvRate?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional() @IsBoolean()
  moraAcumulaSiguienteCiclo?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional() @IsBoolean()
  reconexionAcumulaSiguienteCiclo?: boolean;
}
