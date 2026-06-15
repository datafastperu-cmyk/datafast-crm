import {
  IsString, IsUUID, IsOptional, IsBoolean,
  IsNotEmpty, IsIP, IsInt, Min, Max, MaxLength,
  IsEnum, ValidateNested, IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform }                  from 'class-transformer';

// ─── DTO principal del flujo completo ────────────────────────
export class AprovisionarFtthDto {

  // ── Identificadores del contrato ─────────────────────────
  @ApiProperty({ description: 'UUID del contrato existente en estado PENDIENTE_ACTIVACION' })
  @IsUUID()
  @IsNotEmpty()
  contratoId: string;

  @ApiProperty({ description: 'UUID del cliente (validación cruzada)' })
  @IsUUID()
  @IsNotEmpty()
  clienteId: string;

  // ── OLT / ONU ─────────────────────────────────────────────
  @ApiProperty({ description: 'UUID del OLT (registro local) donde está la ONU' })
  @IsUUID()
  @IsNotEmpty()
  oltId: string;

  @ApiPropertyOptional({
    description:
      'Serial Number de la ONU. Si se omite, se detecta automáticamente ' +
      'buscando la primera ONU no aprovisionada en el ponPort indicado.',
    example: '48575443ABCD1234',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Transform(({ value }) => value?.trim().toUpperCase())
  serialNumber?: string;

  @ApiProperty({
    example: '0/1/3',
    description: 'Puerto PON en formato slot/subslot/port (Huawei MA5800)',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  ponPort: string;

  @ApiProperty({
    example: 'HSI-BRIDGE-100M',
    description: 'Nombre exacto del perfil de servicio en SmartOLT',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  perfilSmartolt: string;

  @ApiProperty({ example: 100, description: 'VLAN del servicio (1–4094)' })
  @IsInt()
  @Min(1)
  @Max(4094)
  @Type(() => Number)
  vlanId: number;

  @ApiPropertyOptional({ enum: ['access', 'trunk'], default: 'access' })
  @IsOptional()
  @IsString()
  vlanModo?: string = 'access';

  // ── Router Mikrotik ───────────────────────────────────────
  @ApiProperty({ description: 'UUID del router Mikrotik donde crear PPPoE + Queue' })
  @IsUUID()
  @IsNotEmpty()
  routerId: string;

  // ── Pool IPv4 (opcional — si el contrato ya tiene IP asignada se omite) ──
  @ApiPropertyOptional({
    description:
      'UUID del segmento IPv4 del que tomar la próxima IP disponible. ' +
      'Si el contrato ya tiene ip_asignada, este campo se ignora.',
  })
  @IsOptional()
  @IsUUID()
  segmentoId?: string;

  @ApiPropertyOptional({
    description: 'IP específica a asignar (sobreescribe el pool automático)',
    example: '192.168.1.50',
  })
  @IsOptional()
  @IsIP()
  ipManual?: string;

  // ── Opciones de notificación ─────────────────────────────
  @ApiPropertyOptional({
    description: 'Enviar WhatsApp al cliente al activar el servicio',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  notificarWhatsApp?: boolean = true;

  @ApiPropertyOptional({
    description: 'Enviar email al cliente al activar el servicio',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  notificarEmail?: boolean = false;

  // ── Amarre IP/MAC ─────────────────────────────────────────
  @ApiPropertyOptional({
    description:
      'Nombre del servidor DHCP en Mikrotik (solo para tipo_control=amarre_ip_mac_dhcp). ' +
      'Si se omite, el sistema detecta automáticamente el servidor en la interface del segmento.',
    example: 'dhcp1',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  dhcpServer?: string;

  // ── Opciones avanzadas ───────────────────────────────────
  @ApiPropertyOptional({
    description: 'Omitir el paso de configuración de velocidad en Mikrotik (para debug)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  omitirQueue?: boolean = false;

  @ApiPropertyOptional({
    description: 'En caso de error en algún paso, hacer rollback de los pasos anteriores',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  rollbackEnError?: boolean = true;
}

// ─── DTO para reversión (rollback) ───────────────────────────
export class RollbackAprovisionamientoDto {
  @ApiProperty({ description: 'UUID del contrato a revertir' })
  @IsUUID()
  @IsNotEmpty()
  contratoId: string;

  @ApiPropertyOptional({ description: 'Motivo del rollback' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;

  @ApiPropertyOptional({ description: 'Eliminar provisión de SmartOLT', default: true })
  @IsOptional()
  @IsBoolean()
  eliminarSmartolt?: boolean = true;

  @ApiPropertyOptional({ description: 'Eliminar usuario PPPoE del Mikrotik', default: true })
  @IsOptional()
  @IsBoolean()
  eliminarPppoe?: boolean = true;

  @ApiPropertyOptional({ description: 'Liberar IP del pool', default: true })
  @IsOptional()
  @IsBoolean()
  liberarIp?: boolean = true;
}

// ─── Resultado de cada paso ────────────────────────────────
export class PasoResultadoDto {
  @ApiProperty() paso:     number;
  @ApiProperty() nombre:   string;
  @ApiProperty({ enum: ['ok', 'error', 'omitido', 'revertido'] })
               estado:   'ok' | 'error' | 'omitido' | 'revertido';
  @ApiProperty() detalle:  string;
  @ApiPropertyOptional() duracionMs?: number;
  @ApiPropertyOptional() datos?: Record<string, any>;
}

// ─── Respuesta completa del aprovisionamiento ─────────────────
export class AprovisionamientoResultadoDto {
  @ApiProperty({ type: [PasoResultadoDto] })
  pasos:          PasoResultadoDto[];

  @ApiProperty() exitoso:        boolean;
  @ApiProperty() contratoId:     string;

  @ApiPropertyOptional() ipAsignada?:    string;
  @ApiPropertyOptional() usuarioPppoe?:  string;
  @ApiPropertyOptional() onuId?:         string;
  @ApiPropertyOptional() serialNumber?:  string;
  @ApiPropertyOptional() duracionTotalMs?: number;

  @ApiProperty() mensajeFinal:   string;
  @ApiPropertyOptional() rollbackEjecutado?: boolean;
  @ApiPropertyOptional() pasosFallidos?: number[];
}
