import { Module } from '@nestjs/common';

import { AplicadorFacturaService } from './aplicador-factura.service';

/**
 * La frontera del dinero, como módulo.
 *
 * Deliberadamente sin dependencias más allá de la conexión a base de datos: lo importan
 * facturación, pagos y adelantos, y cualquier import que se le añada aquí puede crear el
 * ciclo pagos ↔ facturación que `AdelantosModule` evita desde su creación.
 *
 * Si algún día esto necesita auditoría, colas o notificaciones, la respuesta correcta NO
 * es importarlas aquí: es que ese efecto pertenece al camino que llama, no al movimiento
 * del saldo.
 */
@Module({
  providers: [AplicadorFacturaService],
  exports:   [AplicadorFacturaService],
})
export class AplicadorFacturaModule {}
