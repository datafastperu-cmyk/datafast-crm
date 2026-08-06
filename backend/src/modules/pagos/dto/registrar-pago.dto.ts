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
import { IsEnum } from 'class-validator';

import { MotivoExtorno } from '../entities/pago.entity';

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

  /** Requerido para un adelanto: el dinero es de un abonado, aunque aún no de una factura. */
  @IsOptional()
  @IsUUID('4')
  clienteId?: string;

  /**
   * Adelanto: cobro sin comprobante asignado. Queda como saldo a favor del abonado y se
   * consume al emitir su siguiente comprobante. Se exige explícito para que un `facturaId`
   * olvidado no acabe convertido en adelanto por accidente.
   */
  @IsOptional()
  @IsBoolean()
  esAdelanto?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notas?: string;

  /**
   * `false` = cobrar SIN devolver el servicio ("Solo registrar" en la caja).
   *
   * Existe para la baja voluntaria que salda su último comprobante: con la reactivación
   * automática, el ERP le devolvía el servicio a un abonado que se está yendo. Por defecto
   * se reactiva, que es el comportamiento normal de un cobro.
   */
  @IsOptional()
  @IsBoolean()
  reactivarServicio?: boolean;

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

  /**
   * El medio concreto por el que entró el dinero (Yape, BCP, la oficina).
   *
   * Opcional durante la transición: los dos formularios vivos siguen mandando
   * `metodoPago` + `banco`, y el backend resuelve el canal a partir de eso
   * (`CanalPagoService.resolverDesdeLegacy`). Pasa a obligatorio en F5, cuando el
   * formulario nuevo lo envíe y no haya nada que adivinar.
   */
  @IsOptional()
  @IsUUID('4')
  canalPagoId?: string;

  /**
   * Dónde entró el dinero. Si no viene, se toma la cuenta por defecto del canal.
   * Enviarla explícitamente requiere permiso: cambiarla es un movimiento de tesorería.
   */
  @IsOptional()
  @IsUUID('4')
  cuentaReceptoraId?: string;

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

/**
 * Anulación de un cobro ya registrado.
 *
 * El motivo es obligatorio y tipificado porque decide dos cosas que no se pueden inferir:
 * si el dinero vuelve al abonado, y si cortarle el servicio es legítimo o es un error
 * nuestro (`error_registro` es lo segundo, y es el caso más frecuente).
 */
export class ExtornarPagoDto {
  @IsEnum(MotivoExtorno, {
    message:
      'motivo debe ser uno de: error_registro, devolucion_cliente, cheque_rebotado, ' +
      'contracargo, pago_duplicado, fraude',
  })
  motivo: MotivoExtorno;

  /** Obligatoria si el pago ya estaba conciliado — ver `PagosService.extornar`. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  nota?: string;
}
