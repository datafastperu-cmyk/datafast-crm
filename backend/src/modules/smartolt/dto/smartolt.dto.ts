import {
  IsString, IsUUID, IsOptional, IsEnum, IsInt,
  IsNotEmpty, Min, Max, MaxLength, IsIP, IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import { EstadoOnu } from '../entities/onu.entity';
import { PaginationDto } from '../../../common/dto/response.dto';

// ─── OLT ─────────────────────────────────────────────────────
export class CreateOltDto {
  @ApiProperty({ example: 'OLT Centro Piura' })
  @IsString() @IsNotEmpty() @MaxLength(100)
  nombre: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(500)
  descripcion?: string;

  @ApiPropertyOptional({ default: 'Huawei' })
  @IsOptional() @IsString() @MaxLength(50)
  marca?: string;

  @ApiPropertyOptional({ example: 'MA5800-X7' })
  @IsOptional() @IsString() @MaxLength(100)
  modelo?: string;

  @ApiPropertyOptional({ description: 'ID del dispositivo en SmartOLT' })
  @IsOptional() @IsString() @MaxLength(100)
  smartoltId?: string;

  @ApiPropertyOptional({ example: '10.0.0.1' })
  @IsOptional() @IsIP()
  ipGestion?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(100)
  usuario?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(200)
  password?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(200)
  ubicacion?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsInt() @Min(1) @Max(64) @Type(() => Number)
  totalPonPorts?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  activo?: boolean;
}

export class UpdateOltDto extends PartialType(CreateOltDto) {}

// ─── ONU: aprovisionar en OLT ────────────────────────────────
export class ProvisionarOnuDto {
  @ApiProperty({ description: 'ID del OLT en el sistema' })
  @IsUUID() @IsNotEmpty()
  oltId: string;

  @ApiProperty({ example: '48575443ABCD1234', description: 'Serial Number de la ONU' })
  @IsString() @IsNotEmpty() @MaxLength(50)
  @Transform(({ value }) => value?.trim().toUpperCase())
  serialNumber: string;

  @ApiProperty({ example: '0/1/3', description: 'Puerto PON en formato slot/subslot/port' })
  @IsString() @IsNotEmpty() @MaxLength(20)
  ponPort: string;

  @ApiProperty({ example: 'HSI-BRIDGE-100M', description: 'Perfil de servicio en SmartOLT' })
  @IsString() @IsNotEmpty() @MaxLength(100)
  perfil: string;

  @ApiProperty({ example: 100, description: 'VLAN ID del servicio (1-4094)' })
  @IsInt() @Min(1) @Max(4094) @Type(() => Number)
  vlanId: number;

  @ApiPropertyOptional({ example: 'access' })
  @IsOptional() @IsString()
  vlanModo?: string;

  @ApiPropertyOptional({ description: 'Descripción visible en SmartOLT' })
  @IsOptional() @IsString() @MaxLength(200)
  descripcion?: string;

  @ApiPropertyOptional({ description: 'ID del contrato a asociar' })
  @IsOptional() @IsUUID()
  contratoId?: string;

  @ApiPropertyOptional({ description: 'Modelo físico de la ONU (ej: HG8310M)' })
  @IsOptional() @IsString() @MaxLength(100)
  modelo?: string;
}

// ─── Flujo completo FTTH ─────────────────────────────────────
export class FlujoComipletoFtthDto {
  // ── Contrato y cliente ────────────────────────────────────
  @ApiProperty({ description: 'UUID del contrato en el sistema' })
  @IsUUID() @IsNotEmpty()
  contratoId: string;

  @ApiProperty({ description: 'UUID del cliente' })
  @IsUUID() @IsNotEmpty()
  clienteId: string;

  // ── OLT y ONU ────────────────────────────────────────────
  @ApiProperty({ description: 'UUID del OLT donde está conectada la ONU' })
  @IsUUID() @IsNotEmpty()
  oltId: string;

  @ApiPropertyOptional({ description: 'SN de la ONU (si ya se conoce). Si omitido: detectar automáticamente' })
  @IsOptional() @IsString() @MaxLength(50)
  @Transform(({ value }) => value?.trim().toUpperCase())
  serialNumber?: string;

  @ApiProperty({ example: '0/1/3' })
  @IsString() @IsNotEmpty() @MaxLength(20)
  ponPort: string;

  @ApiProperty({ description: 'Perfil de SmartOLT para el plan del cliente' })
  @IsString() @IsNotEmpty() @MaxLength(100)
  perfil: string;

  @ApiProperty({ example: 100 })
  @IsInt() @Min(1) @Max(4094) @Type(() => Number)
  vlanId: number;

  // ── Mikrotik (PPPoE + Queue) ──────────────────────────────
  @ApiProperty({ description: 'UUID del router Mikrotik al que conectar' })
  @IsUUID() @IsNotEmpty()
  routerId: string;

  @ApiProperty({ description: 'UUID del segmento IPv4 para asignar IP' })
  @IsOptional() @IsUUID()
  segmentoId?: string;

  @ApiPropertyOptional({ description: 'Notificar al cliente por WhatsApp al activar' })
  @IsOptional() @IsBoolean()
  notificarCliente?: boolean;
}

// ─── Asociar ONU a contrato ───────────────────────────────────
export class AsociarOnuContratoDto {
  @ApiProperty() @IsUUID() @IsNotEmpty()
  contratoId: string;

  @ApiProperty() @IsUUID() @IsNotEmpty()
  onuId: string;
}

// ─── Filtros de ONU ───────────────────────────────────────────
export class FilterOnuDto extends PaginationDto {
  @ApiPropertyOptional({ enum: EstadoOnu })
  @IsOptional() @IsEnum(EstadoOnu)
  estado?: EstadoOnu;

  @ApiPropertyOptional()
  @IsOptional() @IsUUID()
  oltId?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  @Transform(({ value }) => value?.trim())
  serialNumber?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  ponPort?: string;

  @ApiPropertyOptional({ description: 'Solo ONUs sin contrato asignado' })
  @IsOptional() @IsBoolean()
  sinContrato?: boolean;
}

// ─── Señal óptica ─────────────────────────────────────────────
export class ActualizarSeñalDto {
  @ApiPropertyOptional()
  @IsOptional() @Type(() => Number)
  rxPowerDbm?: number;

  @ApiPropertyOptional()
  @IsOptional() @Type(() => Number)
  txPowerDbm?: number;

  @ApiPropertyOptional()
  @IsOptional() @Type(() => Number)
  temperaturaC?: number;
}

// ─── Respuesta del flujo FTTH ─────────────────────────────────
export class FlujoComipletoResultadoDto {
  pasos: Array<{
    paso:     number;
    nombre:   string;
    estado:   'ok' | 'error' | 'omitido';
    detalle:  string;
    duracionMs?: number;
  }>;
  exitoso:     boolean;
  onuId?:      string;
  ipAsignada?: string;
  usuarioPppoe?: string;
  mensajeFinal: string;
}
