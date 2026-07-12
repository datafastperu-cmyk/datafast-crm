import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';

import { FacturacionController }       from './facturacion.controller';
import { ComprobantesConfigController } from './comprobantes-config.controller';

import { FacturacionService }          from './facturacion.service';
import { ComprobantesConfigService }   from './comprobantes-config.service';
import { FacturaRepository }           from './repositories/factura.repository';
import { PdfService }                  from './pdf.service';
import {
  FacturacionWorker,
  FacturacionScheduler,
  FACTURACION_QUEUE,
} from './facturacion.worker';

import { Factura }                     from './entities/factura.entity';
import { ComprobanteConfig }           from './entities/comprobante-config.entity';
import { ConfiguracionFacturacion }    from './entities/configuracion-facturacion.entity';
import { CargoPendiente }              from './entities/cargo-pendiente.entity';
import { AuthModule }                  from '../auth/auth.module';
import { ConfiguracionModule }         from '../config/config.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Factura,
      ComprobanteConfig,
      ConfiguracionFacturacion,
      CargoPendiente,
    ]),

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
    ConfiguracionModule,
  ],
  controllers: [
    FacturacionController,
    ComprobantesConfigController,
  ],
  providers: [
    FacturacionService,
    ComprobantesConfigService,
    FacturaRepository,
    PdfService,
    FacturacionWorker,
    FacturacionScheduler,
  ],
  exports: [
    FacturacionService,
    ComprobantesConfigService,
    FacturaRepository,
  ],
})
export class FacturacionModule {}
