import { Global, Module } from '@nestjs/common';
import { WatcherHeartbeatService } from './services/watcher-heartbeat.service';

// @Global() por la misma razón que ModuleHealthModule: los watchers viven repartidos por
// todo el ERP (olt-nativo, outbox-red, openvpn, workers) y obligar a cada módulo a
// importar este sería fricción que termina en watchers sin latido — justo lo que se
// quiere evitar.
@Global()
@Module({
  providers: [WatcherHeartbeatService],
  exports:   [WatcherHeartbeatService],
})
export class WatcherHeartbeatModule {}
