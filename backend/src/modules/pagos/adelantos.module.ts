import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdelantosService } from './adelantos.service';
import { PagoAplicacion }   from './entities/pago-aplicacion.entity';
import { AuthModule }       from '../auth/auth.module';
import { AplicadorFacturaModule } from '../facturacion/aplicador-factura.module';

/**
 * Módulo propio para el saldo a favor.
 *
 * Lo consumen tanto pagos (registrar y devolver adelantos) como facturación (consumir el
 * saldo al emitir un comprobante). Si viviera dentro de cualquiera de los dos, el otro
 * tendría que importarlo y aparecería un ciclo pagos ↔ facturación que hoy no existe.
 * Aquí no depende de ninguno: solo de la BD, la auditoría y el aplicador.
 *
 * `AplicadorFacturaModule` no rompe esa propiedad justamente porque es lo que es: la
 * frontera del dinero, sin más dependencia que la conexión. Consumir un saldo a favor
 * mueve el saldo de un comprobante, y eso tiene que pasar por el mismo sitio que un cobro
 * — antes aquí había una copia del UPDATE que había perdido el guard de estado y aplicaba
 * el adelanto contra comprobantes anulados.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PagoAplicacion]),
    AuthModule,
    AplicadorFacturaModule,
  ],
  providers: [AdelantosService],
  exports:   [AdelantosService],
})
export class AdelantosModule {}
