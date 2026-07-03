import {
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  Length,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class RegistrarPagoDto {
  @IsUUID('4')
  @IsNotEmpty()
  facturaId: string;

  @IsNumber({ allowInfinity: false, allowNaN: false, maxDecimalPlaces: 2 })
  @IsPositive()
  monto: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  metodoPago: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  banco?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 50)
  numeroOperacion?: string;

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
