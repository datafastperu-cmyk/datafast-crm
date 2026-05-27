import {
  IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID,
  Matches, MaxLength, MinLength, ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { z } from 'zod';

// ─── Tipos de autenticación soportados ───────────────────────
export enum AuthType {
  PPPOE    = 'PPPOE',
  ARP      = 'ARP',
  DHCP_ARP = 'DHCP_ARP',
}

// ─── Regex reutilizables ─────────────────────────────────────
const RE_IPV4 = /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
const RE_MAC  = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
// PPPoE: letras, dígitos, guión, punto, arroba, guión_bajo — sin espacios
const RE_PPPOE_USER = /^[a-zA-Z0-9._@-]+$/;

// ─── DTO principal ────────────────────────────────────────────
export class CreateMikrotikUserDto {

  @ApiProperty({ description: 'UUID del contrato en estado PENDIENTE_INSTALACION' })
  @IsUUID()
  @IsNotEmpty()
  contratoId: string;

  @ApiProperty({ enum: AuthType, description: 'Estrategia de autenticación del cliente' })
  @IsEnum(AuthType)
  authType: AuthType;

  // ── Campos PPPoE ─────────────────────────────────────────
  @ApiPropertyOptional({ example: 'cliente-001' })
  @ValidateIf((o) => o.authType === AuthType.PPPOE)
  @IsNotEmpty({ message: 'username es requerido para PPPOE' })
  @IsString()
  @MaxLength(64)
  @Matches(RE_PPPOE_USER, {
    message: 'username solo puede contener letras, dígitos, punto, guión, arroba y guión_bajo',
  })
  @Transform(({ value }) => value?.trim().toLowerCase())
  username?: string;

  @ApiPropertyOptional({ example: 'clave-segura-123' })
  @ValidateIf((o) => o.authType === AuthType.PPPOE)
  @IsNotEmpty({ message: 'password es requerido para PPPOE' })
  @IsString()
  @MinLength(6, { message: 'password debe tener al menos 6 caracteres' })
  @MaxLength(128)
  password?: string;

  @ApiPropertyOptional({ example: 'perfil-10m', description: 'Perfil PPPoE en RouterOS' })
  @ValidateIf((o) => o.authType === AuthType.PPPOE)
  @IsNotEmpty({ message: 'pppoeProfile es requerido para PPPOE' })
  @IsString()
  @MaxLength(100)
  pppoeProfile?: string;

  // ── Campos ARP / DHCP_ARP ────────────────────────────────
  @ApiPropertyOptional({ example: '192.168.100.50' })
  @ValidateIf((o) => o.authType === AuthType.ARP || o.authType === AuthType.DHCP_ARP)
  @IsNotEmpty({ message: 'ipAddress es requerido para ARP y DHCP_ARP' })
  @IsString()
  @Matches(RE_IPV4, { message: 'ipAddress debe ser una IPv4 válida (ej: 192.168.1.50)' })
  ipAddress?: string;

  @ApiPropertyOptional({ example: 'AA:BB:CC:DD:EE:FF' })
  @ValidateIf((o) => o.authType === AuthType.ARP || o.authType === AuthType.DHCP_ARP)
  @IsNotEmpty({ message: 'macAddress es requerido para ARP y DHCP_ARP' })
  @IsString()
  @Matches(RE_MAC, { message: 'macAddress debe tener el formato XX:XX:XX:XX:XX:XX' })
  @Transform(({ value }) => value?.toUpperCase())
  macAddress?: string;

  // ── DHCP_ARP: nombre del servidor DHCP en RouterOS ───────
  @ApiPropertyOptional({ example: 'dhcp-lan', description: 'Nombre del servidor DHCP en RouterOS' })
  @ValidateIf((o) => o.authType === AuthType.DHCP_ARP)
  @IsNotEmpty({ message: 'dhcpServer es requerido para DHCP_ARP' })
  @IsString()
  @MaxLength(100)
  dhcpServer?: string;

  // ── Común a ARP y DHCP_ARP: nombre del perfil de cola ───
  @ApiPropertyOptional({ example: 'cliente-001', description: 'Nombre base para la Simple Queue' })
  @ValidateIf((o) => o.authType === AuthType.ARP || o.authType === AuthType.DHCP_ARP)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  queueName?: string;

  // ── Interfaz ARP (opcional, para forzar la tabla ARP) ───
  @ApiPropertyOptional({ example: 'bridge-lan' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  arpInterface?: string;
}

// ─── Zod schema (para validación en frontend / server actions) ─
export const createMikrotikUserSchema = z.discriminatedUnion('authType', [

  z.object({
    contratoId:   z.string().uuid(),
    authType:     z.literal(AuthType.PPPOE),
    username:     z.string()
                    .min(1).max(64)
                    .regex(RE_PPPOE_USER, 'Solo letras, dígitos, punto, guión, arroba y guión_bajo')
                    .transform((v) => v.trim().toLowerCase()),
    password:     z.string().min(6).max(128),
    pppoeProfile: z.string().min(1).max(100),
  }),

  z.object({
    contratoId:   z.string().uuid(),
    authType:     z.literal(AuthType.ARP),
    ipAddress:    z.string().regex(RE_IPV4, 'IPv4 inválida'),
    macAddress:   z.string().regex(RE_MAC, 'Formato XX:XX:XX:XX:XX:XX').toUpperCase(),
    queueName:    z.string().min(1).max(64).optional(),
    arpInterface: z.string().max(64).optional(),
  }),

  z.object({
    contratoId:   z.string().uuid(),
    authType:     z.literal(AuthType.DHCP_ARP),
    ipAddress:    z.string().regex(RE_IPV4, 'IPv4 inválida'),
    macAddress:   z.string().regex(RE_MAC, 'Formato XX:XX:XX:XX:XX:XX').toUpperCase(),
    dhcpServer:   z.string().min(1).max(100),
    queueName:    z.string().min(1).max(64).optional(),
    arpInterface: z.string().max(64).optional(),
  }),
]);

export type CreateMikrotikUserInput = z.infer<typeof createMikrotikUserSchema>;

// ─── Resultado de la operación ────────────────────────────────
export interface MikrotikUserResult {
  contratoId:     string;
  authType:       AuthType;
  mikrotikId:     string;   // .id retornado por RouterOS
  ipAsignada?:    string;
  macAddress?:    string;
  usuarioPppoe?:  string;
  nombreQueue?:   string;
}
