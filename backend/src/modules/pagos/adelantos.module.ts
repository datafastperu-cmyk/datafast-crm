import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdelantosService } from './adelantos.service';
import { PagoAplicacion }   from './entities/pago-aplicacion.entity';
import { AuthModule }       from '../auth/auth.module';

/**
 * Módulo propio para el saldo a favor.
 *
 * Lo consumen tanto pagos (registrar y devolver adelantos) como facturación (consumir el
 * saldo al emitir un comprobante). Si viviera dentro de cualquiera de los dos, el otro
 * tendría que importarlo y aparecería un ciclo pagos ↔ facturación que hoy no existe.
 * Aquí no depende de ninguno: solo de la BD y de la auditoría.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PagoAplicacion]),
    AuthModule,
  ],
  providers: [AdelantosService],
  exports:   [AdelantosService],
})
export class AdelantosModule {}
