import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

import { PagosController }     from './pagos.controller';
import { PagosService }        from './pagos.service';
import { PagoRepository }      from './repositories/pago.repository';
import { MercadoPagoService }  from './mercadopago.service';

import { Pago, CuentaBancaria } from './entities/pago.entity';

// Importar módulos con los que interactúa
import { FacturacionModule }  from '../facturacion/facturacion.module';
import { ContratosModule }    from '../contratos/contratos.module';
import { AuthModule }         from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Pago, CuentaBancaria]),

    // HTTP client para llamadas a la API de MercadoPago
    HttpModule.register({
      timeout: 15_000,
      maxRedirects: 3,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'DATAFAST-ISP/1.0',
      },
    }),

    // Multer en memoria para comprobantes/vouchers
    MulterModule.register({ storage: memoryStorage() }),

    // Dependencias de negocio
    FacturacionModule,  // Para aplicarPago() y findOne()
    ContratosModule,    // Para reactivación automática y actualizarDeuda()
    AuthModule,         // Para AuditoriaService
  ],
  controllers: [PagosController],
  providers: [
    PagosService,
    PagoRepository,
    MercadoPagoService,
  ],
  exports: [
    PagosService,
    PagoRepository,
  ],
})
export class PagosModule {}
