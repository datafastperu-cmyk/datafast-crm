import { Module }         from '@nestjs/common';
import { TypeOrmModule }  from '@nestjs/typeorm';
import { AuthModule }     from '../auth/auth.module';
import { OltNativoModule } from '../olt-nativo/olt-nativo.module';
import { FtthOnuRegistro }    from '../olt-nativo/entities/ftth-onu-registro.entity';
import { MetricasOnuOptical } from '../olt-nativo/entities/metricas-onu-optical.entity';
import { RedOnusService }  from './red-onus.service';
import { RedController }   from './red.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([FtthOnuRegistro, MetricasOnuOptical]),
    AuthModule,
    OltNativoModule,  // provee OltNativoService, ProvisionFtthService (ya exportados)
  ],
  controllers: [RedController],
  providers:   [RedOnusService],
  exports:     [RedOnusService],
})
export class RedModule {}
