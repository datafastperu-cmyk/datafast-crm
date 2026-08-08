import { Global, Module } from '@nestjs/common';
import { WatcherHeartbeatService } from './services/watcher-heartbeat.service';
import { CronLatidoService }       from './services/cron-latido.service';
import { LatidoVigilanteService }  from './services/latido-vigilante.service';

// @Global() por la misma razón que ModuleHealthModule: los watchers viven repartidos por
// todo el ERP (olt-nativo, outbox-red, openvpn, workers) y obligar a cada módulo a
// importar este sería fricción que termina en watchers sin latido.
//
// Corrección 2026-08-07 (A-3): eso quitaba la fricción de IMPORTAR y dejaba intacta la de
// LLAMAR, que era la que contaba — con el módulo global desde el 28/07, de 47 crons latía
// 1. `CronLatidoService` cierra el hueco haciendo el latido automático para todo lo que
// esté en el SchedulerRegistry, y `LatidoVigilanteService` lo convierte en alarma.
//
// Los dos servicios nuevos son complementarios y NUNCA coinciden en el mismo proceso:
// late el que ejecuta crons (RUN_CRONS=true), vigila el que no.
@Global()
@Module({
  providers: [WatcherHeartbeatService, CronLatidoService, LatidoVigilanteService],
  exports:   [WatcherHeartbeatService, CronLatidoService, LatidoVigilanteService],
})
export class WatcherHeartbeatModule {}
