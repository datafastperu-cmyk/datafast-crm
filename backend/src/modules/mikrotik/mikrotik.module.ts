import { Module }              from '@nestjs/common';
import { TypeOrmModule }       from '@nestjs/typeorm';
import { BullModule }          from '@nestjs/bull';
import { ScheduleModule }      from '@nestjs/schedule';
import { EventEmitterModule }  from '@nestjs/event-emitter';

import { MikrotikController }        from './mikrotik.controller';
import { MikrotikService }           from './mikrotik.service';
import { RouterConnectionPool }      from './services/connection-pool.service';
import { PppoeService }              from './services/pppoe.service';
import { QueueService }              from './services/queue.service';
import { FirewallService }           from './services/firewall.service';
import { InterfaceService }          from './services/interface.service';

// Fase 3.2 — Control de velocidad avanzado
import { VelocidadService }          from './services/velocidad/velocidad.service';
import { MangleService }             from './services/velocidad/mangle.service';
import { QueueTreeClienteService }   from './services/velocidad/queue-tree-cliente.service';
import { VelocidadOrquestador }      from './services/velocidad/velocidad-orquestador.service';
import { VelocidadController }       from './velocidad.controller';
import { VelocidadWorker, VelocidadScheduler, VELOCIDAD_QUEUE } from './velocidad.worker';

import { Router }                    from './entities/router.entity';
import { AuthModule }                from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Router]),

    // Cola Bull para sincronización de velocidades
    BullModule.registerQueue({
      name: VELOCIDAD_QUEUE,
      defaultJobOptions: {
        attempts:         3,
        backoff:          { type: 'exponential', delay: 10_000 },
        removeOnComplete: 50,
        removeOnFail:     200,
      },
    }),

    ScheduleModule,

    EventEmitterModule.forRoot({
      wildcard:           false,
      delimiter:          '.',
      newListener:        false,
      removeListener:     false,
      maxListeners:       20,
      verboseMemoryLeak:  true,
      ignoreErrors:       false,
    }),

    AuthModule,
  ],
  controllers: [
    MikrotikController,
    VelocidadController,   // Fase 3.2
  ],
  providers: [
    // Fase 3.1 — Core RouterOS
    MikrotikService,
    RouterConnectionPool,
    PppoeService,
    QueueService,
    FirewallService,
    InterfaceService,

    // Fase 3.2 — Control de velocidad avanzado
    VelocidadService,
    MangleService,
    QueueTreeClienteService,
    VelocidadOrquestador,
    VelocidadWorker,
    VelocidadScheduler,
  ],
  exports: [
    MikrotikService,
    RouterConnectionPool,
    PppoeService,
    QueueService,
    FirewallService,
    InterfaceService,
    VelocidadOrquestador,   // Exportado para uso en módulo de contratos
    VelocidadScheduler,     // Exportado para encolar jobs desde otros módulos
  ],
})
export class MikrotikModule {}
