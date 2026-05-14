import {
  IsString, IsIP, IsOptional, IsEnum, IsBoolean,
  IsNumber, IsNotEmpty, Min, Max, MaxLength,
  IsInt, IsPositive,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  MetodoConexion, VersionRouterOS,
} from '../entities/router.entity';

// ─── Crear Router ─────────────────────────────────────────────
export class CreateRouterDto {
  @ApiProperty({ example: 'Router Castilla Norte' })
  @IsString() @IsNotEmpty() @MaxLength(100)
  nombre: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(500)
  descripcion?: string;

  @ApiPropertyOptional({ example: 'Av. Sánchez Cerro 1234' })
  @IsOptional() @IsString() @MaxLength(200)
  ubicacion?: string;

  @ApiPropertyOptional({ example: 'CCR1036-12G-4S' })
  @IsOptional() @IsString() @MaxLength(100)
  modelo?: string;

  @ApiProperty({ example: '192.168.100.1' })
  @IsIP() @IsNotEmpty()
  ipGestion: string;

  @ApiPropertyOptional({ default: 8728 })
  @IsOptional() @IsInt() @Min(1) @Max(65535) @Type(() => Number)
  puertoApi?: number;

  @ApiPropertyOptional({ default: 8729 })
  @IsOptional() @IsInt() @Min(1) @Max(65535) @Type(() => Number)
  puertoApiSsl?: number;

  @ApiPropertyOptional({ default: 22 })
  @IsOptional() @IsInt() @Min(1) @Max(65535) @Type(() => Number)
  puertoSsh?: number;

  @ApiProperty({ example: 'admin' })
  @IsString() @IsNotEmpty() @MaxLength(100)
  usuario: string;

  @ApiProperty({ example: 'MiPassword123' })
  @IsString() @IsNotEmpty() @MaxLength(200)
  password: string;  // Se cifra antes de guardar

  @ApiPropertyOptional({ enum: MetodoConexion, default: MetodoConexion.API })
  @IsOptional() @IsEnum(MetodoConexion)
  metodoConexion?: MetodoConexion;

  @ApiPropertyOptional({ default: false })
  @IsOptional() @IsBoolean()
  usarSsl?: boolean;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional() @IsInt() @Min(3) @Max(60) @Type(() => Number)
  timeoutConexion?: number;

  @ApiPropertyOptional({ example: -5.1945 })
  @IsOptional() @IsNumber() @Min(-90) @Max(90) @Type(() => Number)
  latitud?: number;

  @ApiPropertyOptional({ example: -80.6328 })
  @IsOptional() @IsNumber() @Min(-180) @Max(180) @Type(() => Number)
  longitud?: number;

  @ApiPropertyOptional({ default: 'public' })
  @IsOptional() @IsString() @MaxLength(100)
  snmpCommunity?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional() @IsBoolean()
  autoConfigurarQueues?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional() @IsBoolean()
  autoConfigurarPppoe?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional() @IsBoolean()
  autoConfigurarFirewall?: boolean;
}

export class UpdateRouterDto extends PartialType(CreateRouterDto) {}

// ─── Provisionar Cliente ──────────────────────────────────────
export class ProvisionarClienteDto {
  @ApiProperty({ description: 'UUID del cliente en el sistema' })
  @IsString() @IsNotEmpty()
  clienteId: string;

  @ApiProperty({ example: 'cli_abc12345' })
  @IsString() @IsNotEmpty() @MaxLength(100)
  usuarioPppoe: string;

  @ApiProperty({ example: 'P@ssw0rd123' })
  @IsString() @IsNotEmpty() @MaxLength(200)
  passwordPppoe: string;

  @ApiProperty({ example: '192.168.1.2' })
  @IsIP()
  ipAsignada: string;

  @ApiPropertyOptional({ example: 'plan-30mbps' })
  @IsOptional() @IsString() @MaxLength(100)
  perfilPppoe?: string;

  @ApiProperty({ example: 30, description: 'Bajada Mbps' })
  @IsInt() @Min(1) @Max(10000) @Type(() => Number)
  downloadMbps: number;

  @ApiProperty({ example: 15, description: 'Subida Mbps' })
  @IsInt() @Min(1) @Max(10000) @Type(() => Number)
  uploadMbps: number;

  @ApiPropertyOptional({ description: 'Burst bajada Mbps' })
  @IsOptional() @IsInt() @Min(1) @Type(() => Number)
  burstDownMbps?: number;

  @ApiPropertyOptional({ description: 'Burst subida Mbps' })
  @IsOptional() @IsInt() @Min(1) @Type(() => Number)
  burstUpMbps?: number;

  @ApiPropertyOptional({ default: 8 })
  @IsOptional() @IsInt() @Min(0) @Type(() => Number)
  burstTiempoSegundos?: number;

  @ApiPropertyOptional({
    enum: ['simple_queue', 'queue_tree', 'pcq', 'sin_limite'],
    default: 'simple_queue',
  })
  @IsOptional() @IsString()
  tipoQueue?: string;
}

// ─── Suspender Cliente ────────────────────────────────────────
export class SuspenderClienteDto {
  @ApiProperty() @IsString() @IsNotEmpty()
  clienteId: string;

  @ApiProperty({ example: '192.168.1.2' })
  @IsIP()
  ipAsignada: string;

  @ApiPropertyOptional({ example: 'cli_abc12345' })
  @IsOptional() @IsString() @MaxLength(100)
  usuarioPppoe?: string;

  @ApiPropertyOptional({ example: 'mora' })
  @IsOptional() @IsString() @MaxLength(200)
  motivo?: string;
}

// ─── Reactivar Cliente ────────────────────────────────────────
export class ReactivarClienteDto {
  @ApiProperty() @IsString() @IsNotEmpty()
  clienteId: string;

  @ApiProperty({ example: '192.168.1.2' })
  @IsIP()
  ipAsignada: string;
}

// ─── DHCP Binding ─────────────────────────────────────────────
export class DhcpBindingDto {
  @ApiProperty({ example: 'AA:BB:CC:DD:EE:FF' })
  @IsString() @IsNotEmpty() @MaxLength(17)
  macAddress: string;

  @ApiProperty({ example: '192.168.1.10' })
  @IsIP()
  ipAddress: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(100)
  hostname?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(200)
  comment?: string;
}

// ─── Actualizar Queue ─────────────────────────────────────────
export class ActualizarQueueDto {
  @ApiProperty({ example: 'cli_abc12345' })
  @IsString() @IsNotEmpty()
  nombreQueue: string;

  @ApiProperty({ example: 30 })
  @IsInt() @Min(1) @Type(() => Number)
  downloadMbps: number;

  @ApiProperty({ example: 15 })
  @IsInt() @Min(1) @Type(() => Number)
  uploadMbps: number;
}

// ─── Ping desde el router ─────────────────────────────────────
export class PingDto {
  @ApiProperty({ example: '8.8.8.8' })
  @IsIP()
  destino: string;

  @ApiPropertyOptional({ default: 4 })
  @IsOptional() @IsInt() @Min(1) @Max(20) @Type(() => Number)
  count?: number;
}
