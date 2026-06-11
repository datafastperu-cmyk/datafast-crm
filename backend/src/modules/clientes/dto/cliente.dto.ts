import {
  IsString, IsEmail, IsOptional, IsEnum, IsBoolean,
  IsNumber, MaxLength, IsArray, Min, Max,
  ValidateIf, Matches, IsNotEmpty, Length, ArrayMinSize,
  IsUUID, IsDateString, IsInt, ValidateNested, IsDate,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { PaginationDto } from '../../../common/dto/response.dto';
import { EstadoCliente, TipoDocumento, TipoServicio } from '../entities/cliente.entity';

export class CreateClienteDto {
  @ApiPropertyOptional({ enum: TipoDocumento, default: TipoDocumento.DNI })
  @IsOptional()
  @IsEnum(TipoDocumento)
  tipoDocumento?: TipoDocumento = TipoDocumento.DNI;

  @ApiProperty({ example: '12345678' })
  @IsString()
  @IsNotEmpty()
  @Length(7, 20)
  @Transform(({ value }) => value?.trim())
  numeroDocumento: string;

  @ApiProperty({ example: 'Juan Carlos' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(({ value }) => value?.trim())
  nombres: string;

  @ApiPropertyOptional({ example: 'Pérez' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(({ value }) => value?.trim())
  apellidoPaterno?: string;

  @ApiPropertyOptional({ example: 'García' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(({ value }) => value?.trim())
  apellidoMaterno?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail({}, { message: 'Email inválido' })
  @MaxLength(150)
  @Transform(({ value }) => value?.toLowerCase().trim())
  email?: string;

  @ApiPropertyOptional({ example: '987654321' })
  @IsOptional()
  @IsString()
  @Matches(/^[\d\s\+\-\(\)]{7,20}$/, { message: 'Teléfono inválido' })
  @Transform(({ value }) => value?.trim())
  telefono?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  telefonoAlt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  whatsapp?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  zonaId?: string;

  @ApiPropertyOptional({ example: 'Av. Sánchez Cerro 1234' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  direccion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  referencia?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  departamento?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  provincia?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  distrito?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10)
  ubigeo?: string;

  @ApiPropertyOptional({ example: -5.1945 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitud?: number;

  @ApiPropertyOptional({ example: -80.6328 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitud?: number;

  @ApiPropertyOptional({ enum: TipoServicio, default: TipoServicio.FTTH })
  @IsOptional()
  @IsEnum(TipoServicio)
  tipoServicio?: TipoServicio;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  codigoCliente?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  usuarioPortal?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  passwordPortal?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notasInternas?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  etiquetas?: string[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  esEmpresa?: boolean;

  @ApiPropertyOptional()
  @ValidateIf((o) => o.esEmpresa === true)
  @IsString()
  @Length(11, 11, { message: 'El RUC debe tener 11 dígitos' })
  rucEmpresa?: string;

  @ApiPropertyOptional()
  @ValidateIf((o) => o.esEmpresa === true)
  @IsString()
  @MaxLength(200)
  razonSocial?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fotoUrl?: string;
}

export class UpdateClienteDto extends PartialType(CreateClienteDto) {
  @ApiPropertyOptional({ description: 'Versión del registro para bloqueo optimista' })
  @IsOptional() @IsInt() @Min(1)
  version?: number;
}

export class FilterClienteDto extends PaginationDto {
  @ApiPropertyOptional({ enum: EstadoCliente })
  @IsOptional()
  @IsEnum(EstadoCliente)
  estado?: EstadoCliente;

  @ApiPropertyOptional({ enum: EstadoCliente, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(EstadoCliente, { each: true })
  @Transform(({ value }) => Array.isArray(value) ? value : [value])
  estados?: EstadoCliente[];

  @ApiPropertyOptional({ enum: TipoServicio })
  @IsOptional()
  @IsEnum(TipoServicio)
  tipoServicio?: TipoServicio;

  @ApiPropertyOptional({ enum: TipoDocumento })
  @IsOptional()
  @IsEnum(TipoDocumento)
  tipoDocumento?: TipoDocumento;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(({ value }) => value?.trim())
  documento?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(({ value }) => value?.trim())
  telefono?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(({ value }) => value?.trim())
  distrito?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vendedorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  conUbicacion?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  esEmpresa?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  etiqueta?: string;

  @ApiPropertyOptional({ example: '2024-01-01' })
  @IsOptional()
  @IsDateString({}, { message: 'fechaDesde debe ser una fecha válida (YYYY-MM-DD)' })
  fechaDesde?: string;

  @ApiPropertyOptional({ example: '2024-12-31' })
  @IsOptional()
  @IsDateString({}, { message: 'fechaHasta debe ser una fecha válida (YYYY-MM-DD)' })
  fechaHasta?: string;
}

export class CambiarEstadoDto {
  @ApiProperty({ enum: EstadoCliente })
  @IsEnum(EstadoCliente)
  estado: EstadoCliente;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}

export class ConsultarReniecDto {
  @ApiProperty({ example: '12345678' })
  @IsString()
  @Matches(/^\d{8}$/, { message: 'El DNI debe ser exactamente 8 dígitos numéricos' })
  dni: string;
}

export class ReniecResponseDto {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  nombreCompleto: string;
  dni: string;
  direccion?: string;
  ubigeo?: string;
  fuente: string;
  consultadoEn: string;
}

export class ExportClientesDto extends OmitType(FilterClienteDto, ['page', 'limit', 'sortBy', 'sortOrder'] as const) {
  @ApiPropertyOptional({ enum: ['csv', 'xlsx'], default: 'csv' })
  @IsOptional()
  formato?: 'csv' | 'xlsx' = 'csv';
}

export type BulkClienteAction = 'suspender' | 'reactivar' | 'baja_temporal' | 'marcar_moroso';

export class BulkActionClienteDto {
  @ApiProperty({ type: [String], example: ['uuid-1', 'uuid-2'] })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  ids: string[];

  @ApiProperty({ enum: ['suspender', 'reactivar', 'baja_temporal', 'marcar_moroso'] })
  @IsEnum(['suspender', 'reactivar', 'baja_temporal', 'marcar_moroso'])
  action: BulkClienteAction;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}

// ─── Tipos estructurados para configuración de facturación ───
export class FacturacionConfigDto {
  @IsOptional() @IsString() tipoFacturacion?: string;
  @IsOptional() @IsInt() @Min(1) @Max(28) @Type(() => Number) diaPago?: number;
  @IsOptional() @IsInt() @Min(0) @Max(30) @Type(() => Number) diasGracia?: number;
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) moraDiaria?: number;
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) cargoReconexion?: number;
  @IsOptional() @IsString() plantillaFactura?: string;
}

export class NotificacionesConfigDto {
  @IsOptional() @IsBoolean() enviarFactura?: boolean;
  @IsOptional() @IsBoolean() recordatorioVencimiento?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(30) @Type(() => Number) diasAntesRecordatorio?: number;
  @IsOptional() @IsString() plantillaBienvenida?: string;
  @IsOptional() @IsString() plantillaCorte?: string;
  @IsOptional() @IsString() plantillaReconexion?: string;
}

export class FacturacionConfigBodyDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => FacturacionConfigDto)
  facturacion?: FacturacionConfigDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => NotificacionesConfigDto)
  notificaciones?: NotificacionesConfigDto;
}

// ─── Onboarding (wizard paso a paso) ─────────────────────────
export class OnboardingContratoDto {
  @IsOptional() @IsUUID() planId?: string;
  @IsOptional() @IsUUID() routerId?: string;
  @IsOptional() @IsUUID() segmentoId?: string;
  @IsOptional() @IsUUID() nodoId?: string;
  @IsOptional()
  @Matches(/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/, { message: 'IP manual inválida' })
  ipManual?: string;
  @IsOptional() @IsString() usuarioPppoe?: string;
  @IsOptional() @IsString() passwordPppoePlain?: string;
  @IsOptional() @IsDateString() fechaInicio?: string;
  @IsOptional() @IsInt() @Min(1) @Max(28) @Type(() => Number) diaFacturacion?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) @Type(() => Number) descuentoPct?: number;
  @IsOptional()
  @Matches(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/, { message: 'MAC address inválida (formato: AA:BB:CC:DD:EE:FF)' })
  macAddress?: string;
  @IsOptional() @IsBoolean() excluirFirewall?: boolean;
  @IsOptional() @IsString() @MaxLength(500) routes?: string;
  @IsOptional()
  @Matches(/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/, { message: 'Dirección IP inválida' })
  ipAdministracion?: string;
  @IsOptional() @IsString() @MaxLength(50) tipoAntena?: string;
  @IsOptional() @IsString() @MaxLength(100) cajaNap?: string;
  @IsOptional() @IsString() @MaxLength(50) puertoNap?: string;
  @IsOptional() @IsString() @MaxLength(500) direccionInstalacion?: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) @Type(() => Number) latitudInstalacion?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) @Type(() => Number) longitudInstalacion?: number;
  @IsOptional() @IsString() @MaxLength(2000) notasInstalacion?: string;
  @IsOptional() @IsString() @MaxLength(2000) notasTecnicas?: string;
  @IsOptional() @IsUUID() antenaApId?: string;
}

export class OnboardingDto {
  @ValidateNested()
  @Type(() => CreateClienteDto)
  cliente: CreateClienteDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => OnboardingContratoDto)
  contrato?: OnboardingContratoDto;

  @IsOptional()
  facturacion?: Record<string, any>;

  @IsOptional()
  notificaciones?: Record<string, any>;
}
