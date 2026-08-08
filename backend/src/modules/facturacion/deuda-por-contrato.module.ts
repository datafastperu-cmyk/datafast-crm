import { Module } from '@nestjs/common';
import { DeudaPorContratoService } from './deuda-por-contrato.service';

/**
 * Módulo propio para el cálculo de la deuda imputada por contrato.
 *
 * Mismo motivo que `AdelantosModule`, y con el mismo precedente: lo consumen facturación
 * (al emitir), pagos (al cobrar y al reactivar), los workers de cobranza y ahora también
 * contratos (reactivación manual). Si viviera dentro de `FacturacionModule`, contratos
 * tendría que importar facturación entera y aparecería un ciclo que hoy no existe.
 *
 * Aquí no depende de nada salvo la conexión a la base.
 *
 * Existe porque la deuda debe tener **una sola definición** y **un solo escritor** de la
 * proyección `contratos.deuda_total` (desviación A-4). Antes había cuatro cálculos, y el
 * de `pagos` sumaba solo `WHERE contrato_id = $1`, ignorando el comprobante consolidado
 * —que es el caso normal— y devolviendo cero para abonados que sí debían.
 */
@Module({
  providers: [DeudaPorContratoService],
  exports:   [DeudaPorContratoService],
})
export class DeudaPorContratoModule {}
