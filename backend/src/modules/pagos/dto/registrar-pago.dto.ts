import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  Length,
} from 'class-validator';
import { Transform } from 'class-transformer';

// Valores en minúsculas alineados 1:1 con el enum MetodoPago de la entidad.
export enum MetodoPago {
  EFECTIVO               = 'efectivo',
  YAPE                   = 'yape',
  PLIN                   = 'plin',
  TRANSFERENCIA_BANCARIA = 'transferencia_bancaria',
  DEPOSITO_BANCARIO      = 'deposito_bancario',
  MERCADOPAGO            = 'mercadopago',
  TARJETA_CREDITO        = 'tarjeta_credito',
  TARJETA_DEBITO         = 'tarjeta_debito',
  CHEQUE                 = 'cheque',
  OTRO                   = 'otro',
}

// Normaliza casing y el alias legacy TRANSFERENCIA_MANUAL → transferencia_bancaria
function normalizarMetodoPago(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const lower = value.toLowerCase();
  if (lower === 'transferencia_manual') return MetodoPago.TRANSFERENCIA_BANCARIA;
  return lower;
}

export class RegistrarPagoDto {
  @IsUUID('4')
  @IsNotEmpty()
  facturaId: string;

  @IsNumber({ allowInfinity: false, allowNaN: false, maxDecimalPlaces: 2 })
  @IsPositive()
  monto: number;

  @Transform(({ value }) => normalizarMetodoPago(value))
  @IsEnum(MetodoPago)
  metodoPago: MetodoPago;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(3, 50)
  numeroOperacion: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{9}$/, { message: 'celularYape debe tener exactamente 9 dígitos numéricos' })
  celularYape?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'otpYape debe tener exactamente 6 dígitos numéricos' })
  otpYape?: string;

  @IsOptional()
  @IsDateString()
  fechaPago?: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  voucherUrl?: string;

  // El cajero puede marcar autoVerificar: true en pagos presenciales (efectivo,
  // depósito, etc.) para que queden VERIFICADO directamente sin un segundo paso.
  @IsOptional()
  @IsBoolean()
  autoVerificar?: boolean;
}
