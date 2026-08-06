import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { HttpModule } from '@nestjs/axios';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { QUEUES } from '../workers/workers.constants';

import { PagosController }     from './pagos.controller';
import { PagosService }        from './pagos.service';
import { PagoRepository }      from './repositories/pago.repository';
import { MercadoPagoService }  from './mercadopago.service';
import { CanalPagoService }    from './canal-pago.service';

import { Pago, CuentaBancaria } from './entities/pago.entity';
import { PagoAplicacion } from './entities/pago-aplicacion.entity';
import { CanalPago }      from './entities/canal-pago.entity';
import { AdelantosModule } from './adelantos.module';

// Importar módulos con los que interactúa
import { FacturacionModule }  from '../facturacion/facturacion.module';
import { ContratosModule }    from '../contratos/contratos.module';
import { AuthModule }         from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Pago, CuentaBancaria, PagoAplicacion, CanalPago]),
    BullModule.registerQueue({ name: QUEUES.COBRANZA }),
    AdelantosModule,

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
    CanalPagoService,
  ],
  exports: [
    PagosService,
    PagoRepository,
    CanalPagoService,
  ],
})
export class PagosModule {}
