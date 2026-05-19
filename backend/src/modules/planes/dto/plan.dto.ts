import { IsString,IsNumber,IsEnum,IsBoolean,IsOptional,IsNotEmpty,Min,Max,MaxLength,IsInt,ValidateIf } from 'class-validator';
import { ApiProperty,ApiPropertyOptional,PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { TipoPlan,TipoQueue,AccionAlLimite } from '../entities/plan.entity';
import { PaginationDto } from '../../../common/dto/response.dto';

export class CreatePlanDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100) nombre: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) descripcion?: string;
  @ApiPropertyOptional({ enum:TipoPlan }) @IsOptional() @IsEnum(TipoPlan) tipo?: TipoPlan;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) colorUi?: string;
  @ApiProperty({ example:20480 }) @IsInt() @Min(0) @Max(1000000) @Type(()=>Number) velocidadBajada: number;
  @ApiProperty({ example:10240 }) @IsInt() @Min(0) @Max(1000000) @Type(()=>Number) velocidadSubida: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000000) @Type(()=>Number) burstBajada?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000000) @Type(()=>Number) burstSubida?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100) @Type(()=>Number) burstUmbral?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Type(()=>Number) burstTiempo?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100) @Type(()=>Number) velocidadGarantizada?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(8) @Type(()=>Number) prioridad?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) addresslist?: string;
  @ApiProperty({ example:85 }) @IsNumber() @Min(0) @Type(()=>Number) precio: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Type(()=>Number) precioInstalacion?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() aplicaIgv?: boolean;
  @ApiProperty({ enum:TipoQueue }) @IsEnum(TipoQueue) tipoQueue: TipoQueue;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) pppProfile?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) pppService?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) poolIp?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(4094) @Type(()=>Number) vlanId?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() tipoServicio?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cicloFacturacion?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() tieneLimiteDatos?: boolean;
  @ValidateIf(o=>o.tieneLimiteDatos===true) @IsInt() @Min(1) @Type(()=>Number) limiteDatosGb?: number;
  @ApiPropertyOptional({ enum:AccionAlLimite }) @IsOptional() @IsEnum(AccionAlLimite) accionAlLimite?: AccionAlLimite;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Type(()=>Number) velocidadPostLimite?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() cuentaIptv?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(5) @Type(()=>Number) sesionesIptv?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() activo?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() visibleEnPortal?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Type(()=>Number) ordenDisplay?: number;
}

export class UpdatePlanDto extends PartialType(CreatePlanDto) {}

export class FilterPlanDto extends PaginationDto {
  @ApiPropertyOptional({ enum:TipoPlan }) @IsOptional() @IsEnum(TipoPlan) tipo?: TipoPlan;
  @ApiPropertyOptional() @IsOptional() @IsString() tipoServicio?: string;
  @ApiPropertyOptional() @IsOptional() activo?: boolean;
  @ApiPropertyOptional() @IsOptional() visibleEnPortal?: boolean;
}
