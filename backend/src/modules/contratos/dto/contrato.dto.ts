import {
  IsString, IsUUID, IsOptional, IsEnum, IsBoolean,
  IsNumber, IsDateString, IsNotEmpty, Min, Max,
  MaxLength, IsInt, IsIP, IsArray, ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { EstadoContrato, TipoPago } from '../entities/contrato.entity';
import { TipoServicio } from '../entities/red.entity';
import { PaginationDto } from '../../../common/dto/response.dto';

// ─── Crear Contrato ───────────────────────────────────────────
export class CreateContratoDto {
  @ApiProperty({ description: 'UUID del cliente' })
  @IsUUID() @IsNotEmpty()
  clienteId: string;

  @ApiPropertyOptional({ description: 'UUID del plan de servicio' })
  @IsOptional() @IsUUID()
  planId?: string;

  @ApiPropertyOptional({ description: 'UUID del router Mikrotik' })
  @IsOptional() @IsUUID()
  routerId?: string;

  @ApiPropertyOptional({ description: 'UUID del nodo/antena' })
  @IsOptional() @IsUUID()
  nodoId?: string;

  @ApiPropertyOptional({ description: 'UUID de la antena AP (dispositivo_monitoreo) a la que se conecta el cliente' })
  @IsOptional() @IsUUID()
  antenaApId?: string;

  @ApiPropertyOptional({ description: 'UUID del segmento IPv4 para asignar IP automáticamente' })
  @IsOptional() @IsUUID()
  segmentoId?: string;

  @ApiPropertyOptional({ description: 'IP específica (sobreescribe asignación automática del pool)' })
  @IsOptional()
  @IsIP()
  ipManual?: string;

  @ApiPropertyOptional({ description: 'UUID del técnico responsable de la instalación' })
  @IsOptional() @IsUUID()
  tecnicoInstalacionId?: string;

  @ApiPropertyOptional({ description: 'UUID del vendedor que captó al cliente' })
  @IsOptional() @IsUUID()
  vendedorId?: string;

  @ApiProperty({ example: '2024-01-15', description: 'Fecha de inicio del contrato' })
  @IsDateString()
  fechaInicio: string;

  @ApiPropertyOptional({ example: '2025-01-15', description: 'Fecha de vencimiento (null = indefinido)' })
  @IsOptional() @IsDateString()
  fechaVencimiento?: string;

  // Dirección de instalación (puede diferir de la del cliente)
  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(500)
  direccionInstalacion?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber() @Min(-90) @Max(90) @Type(() => Number)
  latitudInstalacion?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber() @Min(-180) @Max(180) @Type(() => Number)
  longitudInstalacion?: number;

  // Credenciales PPPoE (opcionales — se generan automáticamente si no se proveen)
  @ApiPropertyOptional({ description: 'Usuario PPPoE — se autogenera si se omite' })
  @IsOptional() @IsString() @MaxLength(100)
  usuarioPppoe?: string;

  @ApiPropertyOptional({ description: 'Password PPPoE — se autogenera si se omite' })
  @IsOptional() @IsString() @MaxLength(100)
  passwordPppoePlain?: string; // Se cifra antes de guardar

  @ApiPropertyOptional({ example: 100 })
  @IsOptional() @IsInt() @Min(1) @Max(4094) @Type(() => Number)
  vlanId?: number;

  // Precio (usa el del plan por defecto)
  @ApiPropertyOptional({ description: 'Precio mensual personalizado — si omitido usa el del plan' })
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number)
  precioMensual?: number;

  @ApiPropertyOptional({ example: 10, description: '% de descuento 0-100' })
  @IsOptional() @IsNumber() @Min(0) @Max(100) @Type(() => Number)
  descuentoPct?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(200)
  descuentoMotivo?: string;

  @ApiPropertyOptional({ description: 'Día 1-28 para facturar este contrato' })
  @IsOptional() @IsInt() @Min(1) @Max(28) @Type(() => Number)
  diaFacturacion?: number;

  @ApiPropertyOptional({ enum: TipoPago, description: 'Modalidad de cobro: prepago o postpago' })
  @IsOptional() @IsEnum(TipoPago)
  tipoPago?: TipoPago;

  @ApiPropertyOptional({ example: 'mensual', description: 'mensual | bimestral | trimestral | semestral | anual' })
  @IsOptional() @IsString() @MaxLength(20)
  cicloFacturacion?: string;

  @ApiPropertyOptional({ example: 'fijo', description: 'fijo | variable — determina cómo se calcula la fecha de cobro' })
  @IsOptional() @IsString() @MaxLength(20)
  cicloPago?: string;

  @ApiPropertyOptional({ example: 3, description: 'Días de gracia antes del corte automático por mora' })
  @IsOptional() @IsInt() @Min(0) @Max(60) @Type(() => Number)
  diasProrroga?: number;

  @ApiPropertyOptional({ example: 7, description: 'Días antes del vencimiento para 1er recordatorio' })
  @IsOptional() @IsInt() @Min(1) @Max(30) @Type(() => Number)
  diasRecordatorio1?: number;

  @ApiPropertyOptional({ example: 3, description: 'Días antes del vencimiento para 2do recordatorio' })
  @IsOptional() @IsInt() @Min(1) @Max(30) @Type(() => Number)
  diasRecordatorio2?: number;

  @ApiPropertyOptional({ example: 1, description: 'Días antes del vencimiento para 3er recordatorio' })
  @IsOptional() @IsInt() @Min(1) @Max(30) @Type(() => Number)
  diasRecordatorio3?: number;

  @ApiPropertyOptional({ description: 'Dirección MAC del equipo cliente (AA:BB:CC:DD:EE:FF)' })
  @IsOptional() @IsString() @MaxLength(17)
  macAddress?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional() @IsBoolean()
  excluirFirewall?: boolean;

  @ApiPropertyOptional({ description: 'Rutas adicionales (ej: 192.168.10.0/24)' })
  @IsOptional() @IsString() @MaxLength(500)
  routes?: string;

  @ApiPropertyOptional({ description: 'IP de administración del equipo' })
  @IsOptional() @IsString() @MaxLength(45)
  ipAdministracion?: string;

  @ApiPropertyOptional({ description: 'Tipo de antena/equipo receptor' })
  @IsOptional() @IsString() @MaxLength(50)
  tipoAntena?: string;

  @ApiPropertyOptional({ description: 'Tipo de asignación IPv4', enum: ['estatica','dhcp','pppoe'] })
  @IsOptional() @IsString() @MaxLength(20)
  tipoIpv4?: string;

  @ApiPropertyOptional({ description: 'Descripción del servicio (texto para facturación)' })
  @IsOptional() @IsString() @MaxLength(500)
  descripcionServicio?: string;

  @ApiPropertyOptional({ description: 'Comunidad SNMP para monitoreo del equipo' })
  @IsOptional() @IsString() @MaxLength(100)
  comunidadSnmp?: string;

  @ApiPropertyOptional({ description: 'Usuario para gestión de la antena/equipo' })
  @IsOptional() @IsString() @MaxLength(100)
  usuarioAntena?: string;

  @ApiPropertyOptional({ description: 'Contraseña para gestión de la antena/equipo' })
  @IsOptional() @IsString() @MaxLength(500)
  contrasenaAntena?: string;

  @ApiPropertyOptional({ description: 'Caja NAP de conexión' })
  @IsOptional() @IsString() @MaxLength(100)
  cajaNap?: string;

  @ApiPropertyOptional({ description: 'Puerto NAP de conexión' })
  @IsOptional() @IsString() @MaxLength(50)
  puertoNap?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(2000)
  notasInstalacion?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(2000)
  notasTecnicas?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(2000)
  notasAdmin?: string;

  @ApiPropertyOptional({ description: 'Tipo de autenticación por abonado cuando el router no controla la autenticación', enum: ['ninguna','pppoe','amarre_ip_mac','amarre_ip_mac_dhcp'] })
  @IsOptional() @IsString() @MaxLength(20)
  tipoAuth?: string;
}

// ─── Actualizar Contrato ──────────────────────────────────────
export class UpdateContratoDto extends PartialType(CreateContratoDto) {
  @ApiPropertyOptional({ description: 'Versión del registro para bloqueo optimista' })
  @IsOptional() @IsInt() @Min(1)
  version?: number;
}

// ─── Cambiar Estado ───────────────────────────────────────────
export class CambiarEstadoContratoDto {
  @ApiProperty({ enum: EstadoContrato })
  @IsEnum(EstadoContrato)
  estado: EstadoContrato;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(500)
  motivo?: string;
}

// ─── Prórroga ─────────────────────────────────────────────────
export class OtorgarProrrogaDto {
  @ApiProperty({ example: '2024-02-28', description: 'Fecha límite de la prórroga' })
  @IsDateString()
  prorrogaHasta: string;

  @ApiProperty()
  @IsString() @IsNotEmpty() @MaxLength(500)
  motivo: string;
}

// ─── Filtros ─────────────────────────────────────────────────
export class FilterContratoDto extends PaginationDto {
  @ApiPropertyOptional({ enum: EstadoContrato })
  @IsOptional() @IsEnum(EstadoContrato)
  estado?: EstadoContrato;

  @ApiPropertyOptional({ enum: EstadoContrato, isArray: true })
  @IsOptional()
  estados?: EstadoContrato[];

  @ApiPropertyOptional()
  @IsOptional() @IsUUID()
  clienteId?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsUUID()
  planId?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsUUID()
  routerId?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsUUID()
  tecnicoInstalacionId?: string;

  @ApiPropertyOptional({ description: 'Solo contratos en mora (deuda > 0)' })
  @IsOptional()
  conMora?: boolean;

  @ApiPropertyOptional({ description: 'Solo contratos en prórroga' })
  @IsOptional()
  enProrroga?: boolean;

  @ApiPropertyOptional({ description: 'Solo contratos aprovisionados' })
  @IsOptional()
  aprovisionado?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  fechaDesde?: string;

  @ApiPropertyOptional()
  @IsOptional()
  fechaHasta?: string;
}

// ─── Vista completa del contrato (response) ──────────────────
export class ContratoCompletoDto {
  id: string;
  numeroContrato: string;
  estado: EstadoContrato;
  fechaInicio: string;
  fechaVencimiento: string;
  ipAsignada: string;
  usuarioPppoe: string;
  precioFinal: number;
  deudaTotal: number;
  mesesDeuda: number;
  enProrroga: boolean;
  prorrogaHasta: string;
  aprovisionado: boolean;

  // Relacionados
  cliente: { id: string; nombreCompleto: string; telefono: string; email: string };
  plan: { id: string; nombre: string; velocidadBajada: number; velocidadSubida: number; tipoQueue: string };
  router: { id: string; nombre: string; ipGestion: string } | null;
}

// ─── Segmento IPv4 ────────────────────────────────────────────
export class CreateSegmentoDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100)
  nombre: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  descripcion?: string;

  @ApiProperty({ example: '192.168.1.0/24' }) @IsString() @IsNotEmpty()
  redCidr: string;

  @ApiProperty({ example: '192.168.1.1' }) @IsIP()
  gateway: string;

  @ApiPropertyOptional({ default: '8.8.8.8' }) @IsOptional() @IsIP()
  dnsPrimario?: string;

  @ApiPropertyOptional() @IsOptional() @IsIP()
  dnsSecundario?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  routerId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  nodoId?: string;

  @ApiPropertyOptional({ enum: TipoServicio, default: TipoServicio.FTTH })
  @IsOptional() @IsEnum(TipoServicio)
  tipoServicio?: TipoServicio;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Type(() => Number)
  vlanId?: number;

  @ApiPropertyOptional() @IsOptional() @IsArray() @IsIP('4', { each: true })
  ipsReservadas?: string[];
}
