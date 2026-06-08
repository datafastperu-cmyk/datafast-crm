import { Module }              from '@nestjs/common';
import { TypeOrmModule }       from '@nestjs/typeorm';
import { BullModule }          from '@nestjs/bull';
import { ScheduleModule }      from '@nestjs/schedule';

import { MikrotikController }        from './mikrotik.controller';
import { MikrotikService }           from './mikrotik.service';
import { RouterConnectionPool }      from './services/connection-pool.service';
import { PppoeService }              from './services/pppoe.service';
import { QueueService }              from './services/queue.service';
import { FirewallService }           from './services/firewall.service';
import { InterfaceService }          from './services/interface.service';
import { SubnetRouteService }        from './services/subnet-route.service';
import { ArpService }               from './services/arp.service';
import { WirelessService }          from './services/wireless.service';

// Fase 3.2 — Control de velocidad avanzado
import { VelocidadService }          from './services/velocidad/velocidad.service';
import { MangleService }             from './services/velocidad/mangle.service';
import { QueueTreeClienteService }   from './services/velocidad/queue-tree-cliente.service';
import { VelocidadOrquestador }      from './services/velocidad/velocidad-orquestador.service';
import { VelocidadController }       from './velocidad.controller';
import { VelocidadWorker, VelocidadScheduler, VELOCIDAD_QUEUE } from './velocidad.worker';

import { Router }                    from './entities/router.entity';
import { Contrato }                  from '../contratos/entities/contrato.entity';
import { Plan }                      from '../planes/entities/plan.entity';
import { MikrotikUserService }       from './services/mikrotik-user.service';
import { AuthModule }                from '../auth/auth.module';
import { OpenvpnModule }             from '../openvpn/openvpn.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Router, Contrato, Plan]),

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


    AuthModule,
    OpenvpnModule,
  ],
  controllers: [
    MikrotikController,
    VelocidadController,   // Fase 3.2
  ],
  providers: [
    // Fase 3.1 — Core RouterOS
    MikrotikService,
    MikrotikUserService,
    RouterConnectionPool,
    PppoeService,
    QueueService,
    FirewallService,
    ArpService,
    WirelessService,
    InterfaceService,
    SubnetRouteService,

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
    MikrotikUserService,
    RouterConnectionPool,
    PppoeService,
    QueueService,
    FirewallService,
    ArpService,
    WirelessService,
    InterfaceService,
    SubnetRouteService,
    VelocidadOrquestador,   // Exportado para uso en módulo de contratos
    VelocidadScheduler,     // Exportado para encolar jobs desde otros módulos
  ],
})
export class MikrotikModule {}
