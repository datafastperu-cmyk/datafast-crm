import {
  IsString, IsUUID, IsOptional, IsEnum, IsNumber,
  IsDateString, IsNotEmpty, Min, IsBoolean,
  MaxLength, IsPositive, Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import { MetodoPago, EstadoPago } from '../entities/pago.entity';
import { PaginationDto } from '../../../common/dto/response.dto';


// ─── Verificar / Aprobar pago ─────────────────────────────────
export class VerificarPagoDto {
  @ApiProperty({ description: 'Resultado de la verificación', example: true })
  @IsBoolean()
  aprobado: boolean;

  @ApiPropertyOptional({ description: 'Motivo del rechazo (requerido si aprobado=false)' })
  @IsOptional() @IsString() @MaxLength(500)
  motivoRechazo?: string;

  @ApiPropertyOptional({ description: 'Referencia en el extracto bancario' })
  @IsOptional() @IsString() @MaxLength(200)
  extractoBancoRef?: string;
}

// ─── Conciliar pago ───────────────────────────────────────────
export class ConciliarPagoDto {
  @ApiProperty({ description: 'Referencia en el extracto bancario' })
  @IsString() @IsNotEmpty() @MaxLength(200)
  extractoBancoRef: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(1000)
  notas?: string;
}

// ─── Filtros de búsqueda ─────────────────────────────────────
export class FilterPagoDto extends PaginationDto {
  @ApiPropertyOptional({ enum: EstadoPago })
  @IsOptional() @IsEnum(EstadoPago)
  estado?: EstadoPago;

  @ApiPropertyOptional({ enum: MetodoPago })
  @IsOptional() @IsEnum(MetodoPago)
  metodoPago?: MetodoPago;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  clienteId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  facturaId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  contratoId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  cajeroId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  banco?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  @Transform(({ value }) => value?.trim())
  numeroOperacion?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  fechaDesde?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  fechaHasta?: string;

  @ApiPropertyOptional() @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  conciliado?: boolean;

  @ApiPropertyOptional({ description: 'Solo pagos de hoy' })
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  soloHoy?: boolean;
}

// ─── Webhook de MercadoPago ──────────────────────────────────
export class MercadoPagoWebhookDto {
  action: string;  // 'payment.created' | 'payment.updated'
  api_version: string;
  data: { id: string };
  date_created: string;
  id: string;
  live_mode: boolean;
  type: string;   // 'payment'
  user_id: string;
}

// ─── Preferencia de pago MercadoPago ─────────────────────────
export class CrearPreferenciaDto {
  @ApiProperty()
  @IsUUID()
  facturaId: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  urlExito?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  urlFallo?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  urlPendiente?: string;
}

// ─── Cuenta bancaria ─────────────────────────────────────────
export class CreateCuentaBancariaDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100)
  banco: string;

  @ApiPropertyOptional({ default: 'corriente', enum: ['corriente','ahorros','recaudadora'] })
  @IsOptional() @IsString()
  tipoCuenta?: string;

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(50)
  numeroCuenta: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50)
  cci?: string;

  @ApiPropertyOptional({ default: 'PEN' }) @IsOptional() @IsString()
  moneda?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200)
  titular?: string;

  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean()
  esPrincipal?: boolean;
}

// ─── Dashboard de cobranza ────────────────────────────────────
export class ResumenCobranzaDto {
  cobradoHoy:          number;
  cobradoSemana:       number;
  cobradoMes:          number;
  cobradoMesAnterior:  number;
  pagosHoy:            number;
  pagosSemana:         number;
  pagosMes:            number;
  pendientesVerificar: number;
  porMetodo:           Record<string, { total: number; monto: number }>;
  ultimosPagos:        Partial<Pago>[];
}

// Para importar en ResumenCobranzaDto
import { Pago } from '../entities/pago.entity';
