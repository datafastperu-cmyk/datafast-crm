import {
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

export enum MetodoPago {
  MERCADOPAGO      = 'MERCADOPAGO',
  YAPE             = 'YAPE',
  TRANSFERENCIA_MANUAL = 'TRANSFERENCIA_MANUAL',
}

export class RegistrarPagoDto {
  @IsUUID('4')
  @IsNotEmpty()
  empresaId: string;

  @IsUUID('4')
  @IsNotEmpty()
  facturaId: string;

  @IsNumber({ allowInfinity: false, allowNaN: false, maxDecimalPlaces: 2 })
  @IsPositive()
  monto: number;

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
}
