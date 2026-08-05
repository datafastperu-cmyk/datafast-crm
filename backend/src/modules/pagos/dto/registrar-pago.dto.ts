import {
  ArrayMinSize,
  IsArray,
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
  /**
   * Comprobante a saldar. Se mantiene para el pago de uno solo, que es el caso normal.
   * Para un consolidado se usa `facturaIds`; si vienen los dos, manda `facturaIds`.
   */
  @IsOptional()
  @IsUUID('4')
  facturaId?: string;

  /**
   * Pago consolidado: un solo ingreso de dinero, un solo número de operación, varios
   * comprobantes saldados. Es TODO O NADA — el monto debe cubrir la suma de los saldos —
   * porque repartir un importe insuficiente entre comprobantes obliga a inventar un
   * criterio de imputación que nadie decidió. Para pagar de menos existe el pago
   * individual del comprobante más antiguo.
   */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  facturaIds?: string[];

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
