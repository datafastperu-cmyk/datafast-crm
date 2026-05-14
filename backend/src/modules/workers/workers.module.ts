import { EventEmitterModule } from '@nestjs/event-emitter';
import { Module }          from '@nestjs/common';
import { BullModule }      from '@nestjs/bull';
import { ScheduleModule }  from '@nestjs/schedule';

import { HttpModule }      from '@nestjs/axios';

// Workers
import { CobranzaWorker, CobranzaScheduler }       from './cobranza.worker';
import { FacturacionWorker, FacturacionScheduler }  from './facturacion.worker';

// Módulos de dependencias
import { AuthModule }          from '../auth/auth.module';
import { MikrotikModule }      from '../mikrotik/mikrotik.module';
import { FacturacionModule }   from '../facturacion/facturacion.module';

// Servicios de notificaciones (usados por los workers)
import { WhatsAppService }     from '../notificaciones/services/whatsapp.service';

import { QUEUES } from './workers.constants';

@Module({
  imports: [
    // ── Colas Bull ──────────────────────────────────────────
    BullModule.registerQueue(
      {
        name: QUEUES.COBRANZA,
        defaultJobOptions: {
          attempts:         3,
          backoff:          { type: 'exponential', delay: 30_000 },
          removeOnComplete: 500,
          removeOnFail:     1000,
        },
      },
      {
        name: QUEUES.FACTURACION,
        defaultJobOptions: {
          attempts:         1,
          removeOnComplete: 200,
          removeOnFail:     500,
        },
      },
      {
        name: QUEUES.NOTIFICACIONES,
        defaultJobOptions: {
          attempts:         2,
          backoff:          { type: 'fixed', delay: 60_000 },
          removeOnComplete: 200,
          removeOnFail:     200,
        },
      },
    ),

    ScheduleModule,

    EventEmitterModule.forRoot({
      wildcard:          false,
      delimiter:         '.',
      maxListeners:      30,
      ignoreErrors:      false,
    }),

    HttpModule.register({ timeout: 15_000 }),

    // Módulos de negocio
    AuthModule,
    MikrotikModule,
    FacturacionModule,
  ],
  providers: [
    // Servicios de notificaciones
    WhatsAppService,

    // Cobranza
    CobranzaScheduler,
    CobranzaWorker,

    // Facturación
    FacturacionScheduler,
    FacturacionWorker,
  ],
  exports: [
    CobranzaScheduler,    // Para que PagosModule pueda encolar reactivaciones
    FacturacionScheduler, // Para el controller de facturación manual
  ],
})
export class WorkersModule {}
