import {
  IsString, IsUUID, IsOptional, IsEnum, IsNumber,
  IsDateString, IsNotEmpty, Min, IsBoolean,
  MaxLength, IsPositive, Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import { EstadoPago } from '../entities/pago.entity';
import { PaginationDto } from '../../../common/dto/response.dto';

// RegistrarPagoDto vive en registrar-pago.dto.ts — re-exportado para compatibilidad de imports
export { RegistrarPagoDto, ExtornarPagoDto } from './registrar-pago.dto';

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

// ─── Editar metadatos de un pago ──────────────────────────────
export class ActualizarPagoDto {
  /** Corregir el canal es la forma correcta de corregir por dónde entró un cobro. */
  @ApiPropertyOptional()
  @IsOptional() @IsUUID('4')
  canalPagoId?: string;

  /** Mover solo la cuenta: el canal era correcto y el dinero acabó en otra caja. */
  @ApiPropertyOptional()
  @IsOptional() @IsUUID('4')
  cuentaReceptoraId?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(100)
  metodoPago?: string;

  @ApiPropertyOptional({ example: 'BCP' })
  @IsOptional() @IsString() @MaxLength(100)
  banco?: string;

  @ApiPropertyOptional({ description: 'Fecha de pago (YYYY-MM-DD)' })
  @IsOptional() @IsDateString()
  fechaPago?: string;

  @ApiPropertyOptional({ description: 'Fecha y hora exacta del registro (ISO 8601)' })
  @IsOptional() @IsString()
  registradoEn?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  numeroOperacion?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(2000)
  notas?: string;
}

// ─── Filtros de búsqueda ─────────────────────────────────────
export class FilterPagoDto extends PaginationDto {
  @ApiPropertyOptional({ enum: EstadoPago })
  @IsOptional() @IsEnum(EstadoPago)
  estado?: EstadoPago;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  metodoPago?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  clienteId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  facturaId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  servicioId?: string;

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

  @ApiPropertyOptional({ description: 'Alias de fechaDesde (rango inicio)' })
  @IsOptional() @IsString()
  fechaInicio?: string;

  @ApiPropertyOptional({ description: 'Alias de fechaHasta (rango fin)' })
  @IsOptional() @IsString()
  fechaFin?: string;

  @ApiPropertyOptional({ description: 'UUID de la zona/sector geográfico del cliente' })
  @IsOptional() @IsUUID()
  sectorId?: string;

  @ApiPropertyOptional({ description: 'UUID del router MikroTik del contrato' })
  @IsOptional() @IsUUID()
  routerId?: string;

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
/**
 * Alta de una cuenta receptora: dónde entra el dinero.
 *
 * `banco` y `numeroCuenta` dejan de ser obligatorios porque una CAJA no tiene ninguno de
 * los dos. Mientras lo fueron, el catálogo solo admitía cuentas bancarias — y no había
 * forma de dar de alta "Caja Campo" desde la aplicación.
 */
export class CreateCuentaBancariaDto {
  /**
   * Rótulo operativo: "Caja Principal", "BCP Soles". Es lo que ve el cajero al elegir
   * dónde entró el dinero, y por eso es lo único obligatorio para todos los tipos.
   */
  @ApiProperty({ example: 'BCP Soles' })
  @IsString() @IsNotEmpty() @MaxLength(120)
  nombre: string;

  /** Dónde vive realmente el dinero. Una caja se arquea; una cuenta se concilia. */
  @ApiPropertyOptional({ default: 'banco', enum: ['caja', 'banco', 'pasarela', 'virtual'] })
  @IsOptional() @IsEnum(['caja', 'banco', 'pasarela', 'virtual'] as const, {
    message: 'tipo debe ser caja, banco, pasarela o virtual',
  })
  tipo?: 'caja' | 'banco' | 'pasarela' | 'virtual';

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100)
  banco?: string;

  @ApiPropertyOptional({ default: 'corriente', enum: ['corriente','ahorros','recaudadora'] })
  @IsOptional() @IsString()
  tipoCuenta?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50)
  numeroCuenta?: string;

  /**
   * Una caja con arqueo pertenece a UN responsable. Compartirla entre cobradores hace
   * imposible saber a quién le falta dinero, que es justo para lo que existe una caja.
   */
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean()
  requiereArqueo?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsUUID('4')
  cajeroResponsableId?: string;

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
