import { Module }           from '@nestjs/common';
import { MigracionController } from './migracion.controller';
import { MigracionService }    from './migracion.service';
import { MikrotikModule }      from '../mikrotik/mikrotik.module';
import { SmartoltModule }      from '../smartolt/smartolt.module';
import { OltProviderModule }   from '../olt-provider/olt-provider.module';

@Module({
  imports:     [MikrotikModule, SmartoltModule, OltProviderModule],
  controllers: [MigracionController],
  providers:   [MigracionService],
  exports:     [MigracionService],
})
export class MigracionModule {}
