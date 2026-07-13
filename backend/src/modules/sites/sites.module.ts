import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Site } from './entities/site.entity';
import { Router } from '../mikrotik/entities/router.entity';
import { OltDispositivo } from '../olt-nativo/entities/olt-dispositivo.entity';
import { VpnCliente } from '../openvpn/entities/vpn-cliente.entity';
import { SitesService } from './sites.service';
import { SitesController } from './sites.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Site, Router, OltDispositivo, VpnCliente]),
  ],
  controllers: [SitesController],
  providers: [SitesService],
  exports: [SitesService],
})
export class SitesModule {}
