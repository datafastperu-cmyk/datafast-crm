import {
  IsString, IsIP, IsOptional, IsEnum, IsBoolean,
  IsNumber, IsNotEmpty, Min, Max, MaxLength,
  IsInt, IsPositive, IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  MetodoConexion, VersionRouterOS, TipoControl, TipoControlVelocidad,
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

  @ApiPropertyOptional({ example: '10.8.0.2', description: 'IP asignada por el túnel OpenVPN' })
  @IsOptional() @IsIP()
  vpnIp?: string;

  @ApiPropertyOptional({ enum: TipoControl, default: TipoControl.NINGUNA })
  @IsOptional() @IsEnum(TipoControl)
  tipoControl?: TipoControl;

  @ApiPropertyOptional({ enum: TipoControlVelocidad, default: TipoControlVelocidad.NINGUNO })
  @IsOptional() @IsEnum(TipoControlVelocidad)
  tipoControlVelocidad?: TipoControlVelocidad;

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

  @ApiPropertyOptional({ example: 'Norte', description: 'Zona o sector del router' })
  @IsOptional() @IsString() @MaxLength(100)
  zona?: string;

  @ApiPropertyOptional({ default: 3, description: 'Intentos de reconexión automática' })
  @IsOptional() @IsInt() @Min(1) @Max(10) @Type(() => Number)
  reintentos?: number;

  @ApiPropertyOptional({ enum: VersionRouterOS, default: VersionRouterOS.DESCONOCIDA })
  @IsOptional() @IsEnum(VersionRouterOS)
  versionRos?: VersionRouterOS;

  @ApiPropertyOptional({ description: 'ID del vpn_cliente generado en el wizard — vincula el cert real sin crear uno UUID huérfano' })
  @IsOptional() @IsString() @MaxLength(100)
  vpnClienteId?: string;

  @ApiPropertyOptional({ default: true, description: 'Si true: la autenticación se define a nivel router. Si false: cada abonado define su propia autenticación.' })
  @IsOptional() @IsBoolean()
  controlaAutenticacion?: boolean;
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

// ─── Amarre IP-MAC (ARP estático + opcionalmente DHCP lease) ─────
export class AmareIpMacDto {
  @ApiProperty({ example: '192.168.1.10' })
  @IsIP()
  ip: string;

  @ApiProperty({ example: 'AA:BB:CC:DD:EE:FF' })
  @IsString() @IsNotEmpty() @MaxLength(17)
  mac: string;

  @ApiPropertyOptional({ example: 'PC-Juan-Perez' })
  @IsOptional() @IsString() @MaxLength(100)
  hostname?: string;

  @ApiPropertyOptional({ description: 'UUID del cliente en el sistema' })
  @IsOptional() @IsString()
  clienteId?: string;

  @ApiPropertyOptional({ example: 'dhcp1', description: 'Servidor DHCP en el router' })
  @IsOptional() @IsString() @MaxLength(100)
  dhcpServer?: string;
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

// ─── Test de conexión directa (previo a guardar el router) ────
export class TestConexionDirectaDto {
  @ApiProperty({ example: '192.168.1.1', description: 'IP o dominio del router' })
  @IsString() @IsNotEmpty()
  ip: string;

  @ApiProperty({ example: 8728, description: 'Puerto de conexión' })
  @IsInt() @Min(1) @Max(65535) @Type(() => Number)
  puerto: number;

  @ApiProperty({ example: 'admin' })
  @IsString() @IsNotEmpty() @MaxLength(100)
  usuario: string;

  @ApiPropertyOptional({ example: 'P@ssw0rd', description: 'Contraseña en claro. Omitir o enviar "***stored***" junto con routerId para usar la contraseña guardada en BD.' })
  @IsOptional() @IsString() @MaxLength(200)
  password?: string;

  @ApiPropertyOptional({ description: 'UUID del router existente. Cuando se provee y password es "***stored***"/vacío, el backend recupera las credenciales cifradas de la BD.' })
  @IsOptional() @IsUUID()
  routerId?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional() @IsBoolean()
  usarSsl?: boolean;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional() @IsInt() @Min(3) @Max(30) @Type(() => Number)
  timeoutConexion?: number;

  @ApiPropertyOptional({ enum: MetodoConexion, default: MetodoConexion.API })
  @IsOptional() @IsEnum(MetodoConexion)
  metodoConexion?: MetodoConexion;

  @ApiPropertyOptional({ enum: VersionRouterOS, default: VersionRouterOS.DESCONOCIDA })
  @IsOptional() @IsEnum(VersionRouterOS)
  versionRos?: VersionRouterOS;
}
