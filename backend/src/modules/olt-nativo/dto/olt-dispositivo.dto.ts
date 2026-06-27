import {
  IsEnum, IsIP, IsInt, IsNotEmpty, IsNumber,
  IsOptional, IsString, IsUUID,
  Max, MaxLength, Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { OltMarca, OltMetodoConexion } from '../entities/olt-dispositivo.entity';

// ─── Crear OltDispositivo ─────────────────────────────────────
export class CreateOltDispositivoDto {

  // ── Identificación ────────────────────────────────────────
  @ApiProperty({ example: 'Cabecera Norte - OLT Principal' })
  @IsString() @IsNotEmpty() @MaxLength(150)
  nombre: string;

  @ApiPropertyOptional({ example: 'OLT principal del nodo norte, 8 puertos PON activos' })
  @IsOptional() @IsString() @MaxLength(1000)
  descripcion?: string;

  @ApiProperty({ enum: OltMarca, example: OltMarca.HUAWEI })
  @IsEnum(OltMarca)
  marca: OltMarca;

  @ApiPropertyOptional({ example: 'MA5800-X7' })
  @IsOptional() @IsString() @MaxLength(100)
  modelo?: string;

  // ── Conexión ──────────────────────────────────────────────
  @ApiProperty({ enum: OltMetodoConexion, default: OltMetodoConexion.NATIVO_SSH })
  @IsEnum(OltMetodoConexion)
  metodoConexion: OltMetodoConexion;

  @ApiProperty({
    example: '10.0.50.2',
    description: 'IP privada dentro de la red VPN (no IP pública)',
  })
  @IsIP()
  ipGestion: string;

  @ApiPropertyOptional({
    example: 22,
    description: 'Puerto de conexión: 22 para SSH, 161 para SNMP. Defecto: 22.',
    default: 22,
  })
  @IsOptional() @IsInt() @Min(1) @Max(65535) @Type(() => Number)
  puerto?: number;

  @ApiProperty({ example: 'datafast_admin' })
  @IsString() @IsNotEmpty() @MaxLength(100)
  usuarioAnclado: string;

  @ApiProperty({
    example: 'MiPassword123!',
    description: 'Contraseña en texto plano. El servicio la cifra con AES-256-GCM antes de persistir.',
  })
  @IsString() @IsNotEmpty() @MaxLength(200)
  contrasena: string;   // El servicio llama encrypt(contrasena) → contrasenaCifrada

  // ── Capacidad física ──────────────────────────────────────
  @ApiPropertyOptional({ example: 2, description: 'Número de tarjetas físicas en el chasis', default: 1 })
  @IsOptional() @IsInt() @Min(1) @Max(64) @Type(() => Number)
  slotsTotales?: number;

  @ApiPropertyOptional({ example: 8, description: 'Puertos PON por tarjeta de línea', default: 8 })
  @IsOptional() @IsInt() @Min(1) @Max(128) @Type(() => Number)
  puertosPorSlot?: number;

  @ApiPropertyOptional({
    example: 201,
    description: 'VLAN de gestión/tráfico por defecto. Rango IEEE 802.1Q: 1-4094.',
  })
  @IsOptional() @IsInt() @Min(1) @Max(4094) @Type(() => Number)
  vlanGestionDefecto?: number;

  // ── SNMP ──────────────────────────────────────────────────
  @ApiPropertyOptional({ example: 'public', default: 'public' })
  @IsOptional() @IsString() @MaxLength(100)
  snmpCommunity?: string;

  @ApiPropertyOptional({ example: 2, description: 'Versión SNMP: 1, 2 o 3', default: 2 })
  @IsOptional() @IsInt() @Min(1) @Max(3) @Type(() => Number)
  snmpVersion?: number;

  // ── Relaciones ────────────────────────────────────────────
  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'UUID del Router MikroTik de cabecera detrás del cual reside esta OLT.',
  })
  @IsUUID('4')
  routerId: string;

  @ApiPropertyOptional({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'UUID del DispositivoMonitoreo para vincular telemetría SNMP pasiva. Opcional.',
  })
  @IsOptional() @IsUUID('4')
  dispositivoMonitoreoId?: string;

  // ── Ubicación ─────────────────────────────────────────────
  @ApiPropertyOptional({ example: 'Cabecera Norte — Av. Panamericana km 4.5' })
  @IsOptional() @IsString() @MaxLength(200)
  ubicacion?: string;

  @ApiPropertyOptional({ example: -5.1945 })
  @IsOptional() @IsNumber() @Min(-90) @Max(90) @Type(() => Number)
  latitud?: number;

  @ApiPropertyOptional({ example: -80.6328 })
  @IsOptional() @IsNumber() @Min(-180) @Max(180) @Type(() => Number)
  longitud?: number;
}

// ─── Actualizar OltDispositivo (todos los campos opcionales) ──
// PartialType convierte todos los campos de Create en opcionales
// y hereda sus decoradores de class-validator automáticamente.
export class UpdateOltDispositivoDto extends PartialType(CreateOltDispositivoDto) {}
