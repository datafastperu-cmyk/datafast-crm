import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';

import { FacturacionController } from './facturacion.controller';
import { FacturacionService } from './facturacion.service';
import { FacturaRepository } from './repositories/factura.repository';
import { PdfService } from './pdf.service';
import {
  FacturacionWorker,
  FacturacionScheduler,
  FACTURACION_QUEUE,
} from './facturacion.worker';

import { Factura } from './entities/factura.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Factura]),

    // Cola Bull para generación masiva y jobs de vencimiento
    BullModule.registerQueue({
      name: FACTURACION_QUEUE,
      defaultJobOptions: {
        attempts:  3,
        backoff:   { type: 'exponential', delay: 10_000 },
        removeOnComplete: 100,
        removeOnFail:     500,
      },
    }),

    AuthModule,
  ],
  controllers: [FacturacionController],
  providers: [
    FacturacionService,
    FacturaRepository,
    PdfService,
    FacturacionWorker,
    FacturacionScheduler,
  ],
  exports: [
    // Exportar para uso en módulo de Pagos
    FacturacionService,
    FacturaRepository,
  ],
})
export class FacturacionModule {}
