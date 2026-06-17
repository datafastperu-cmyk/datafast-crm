import {
  IsString, IsUUID, IsOptional, IsBoolean,
  IsNotEmpty, IsIP, IsInt, Min, Max, MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';

// ─── DTO principal WISP → FTTH ────────────────────────────────
export class MigrarWispFtthDto {

  @ApiProperty({ description: 'UUID del contrato WISP a migrar' })
  @IsUUID() @IsNotEmpty()
  contratoId: string;

  @ApiProperty({ description: 'UUID del cliente (validación cruzada)' })
  @IsUUID() @IsNotEmpty()
  clienteId: string;

  // ── OLT / ONU ─────────────────────────────────────────────
  @ApiPropertyOptional({ description: 'UUID del OLT SmartOLT (tabla olts). Requerido si no se usa oltDispositivoId.' })
  @IsOptional() @IsUUID()
  oltId?: string;

  @ApiPropertyOptional({
    description: 'UUID del OltDispositivo (tabla olt_dispositivos) para SSH nativo. Requerido si no se usa oltId.',
  })
  @IsOptional() @IsUUID()
  oltDispositivoId?: string;

  @ApiPropertyOptional({
    description: 'Serial Number de la ONU. Si se omite, se auto-detecta en ponPort.',
    example: '48575443ABCD1234',
  })
  @IsOptional() @IsString() @MaxLength(50)
  @Transform(({ value }) => value?.trim().toUpperCase())
  serialNumber?: string;

  @ApiProperty({ example: '0/1/3', description: 'Puerto PON slot/subslot/port' })
  @IsString() @IsNotEmpty() @MaxLength(20)
  ponPort: string;

  @ApiProperty({ description: 'Perfil de servicio OLT (SmartOLT o nativo)', example: 'HSI-100M' })
  @IsString() @IsNotEmpty() @MaxLength(100)
  perfilOlt: string;

  @ApiProperty({ example: 100, description: 'VLAN del servicio FTTH (1–4094)' })
  @IsInt() @Min(1) @Max(4094) @Type(() => Number)
  vlanId: number;

  @ApiPropertyOptional({ enum: ['access', 'trunk'], default: 'access' })
  @IsOptional() @IsString()
  vlanModo?: string;

  // ── Router FTTH ───────────────────────────────────────────
  @ApiProperty({ description: 'UUID del router MikroTik para el servicio FTTH' })
  @IsUUID() @IsNotEmpty()
  routerFtthId: string;

  // ── Pool IPv4 FTTH ────────────────────────────────────────
  @ApiProperty({ description: 'UUID del segmento IPv4 FTTH para asignar nueva IP' })
  @IsUUID() @IsNotEmpty()
  segmentoFtthId: string;

  @ApiPropertyOptional({ description: 'IP manual FTTH (sobreescribe asignación automática)' })
  @IsOptional() @IsIP()
  ipManual?: string;

  @ApiPropertyOptional({
    description:
      'Nombre del servidor DHCP en Mikrotik (solo para auth_type=amarre_ip_mac_dhcp). ' +
      'Se auto-detecta si se omite.',
  })
  @IsOptional() @IsString() @MaxLength(50)
  dhcpServer?: string;

  // ── Opciones ─────────────────────────────────────────────
  @ApiPropertyOptional({ default: false })
  @IsOptional() @IsBoolean()
  omitirQueue?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional() @IsBoolean()
  rollbackEnError?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional() @IsBoolean()
  notificarWhatsApp?: boolean;
}

// ─── DTO FTTH → WISP ──────────────────────────────────────
export class MigrarFtthWispDto {

  @ApiProperty({ description: 'UUID del contrato FTTH a revertir a WISP' })
  @IsUUID() @IsNotEmpty()
  contratoId: string;

  @ApiProperty({ description: 'UUID del cliente (validación cruzada)' })
  @IsUUID() @IsNotEmpty()
  clienteId: string;

  @ApiProperty({ description: 'UUID del router MikroTik WISP de destino' })
  @IsUUID() @IsNotEmpty()
  routerWispId: string;

  @ApiProperty({ description: 'UUID del segmento IPv4 WISP para asignar IP' })
  @IsUUID() @IsNotEmpty()
  segmentoWispId: string;

  @ApiPropertyOptional({ description: 'IP manual WISP' })
  @IsOptional() @IsIP()
  ipManual?: string;

  @ApiPropertyOptional({ description: 'UUID de la antena AP WISP (opcional)' })
  @IsOptional() @IsUUID()
  antenaApId?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional() @IsBoolean()
  rollbackEnError?: boolean;

  @ApiPropertyOptional({ description: 'Motivo de la reversión' })
  @IsOptional() @IsString() @MaxLength(255)
  motivo?: string;
}

// ─── Resultado de cada paso ────────────────────────────────
export class PasoMigracionDto {
  paso:      number;
  nombre:    string;
  estado:    'ok' | 'error' | 'omitido' | 'revertido';
  detalle:   string;
  duracionMs?: number;
  datos?: Record<string, any>;
}

// ─── Respuesta completa ────────────────────────────────────
export class MigracionResultadoDto {
  pasos:         PasoMigracionDto[];
  exitoso:       boolean;
  contratoId:    string;
  ipFtth?:       string;
  onuId?:        string;
  serialNumber?: string;
  duracionTotalMs?: number;
  mensajeFinal:  string;
  rollbackEjecutado?: boolean;
  pasosFallidos?: number[];
}
