import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PortalConfig } from './entities/portal-config.entity';
import { PortalBanner } from './entities/portal-banner.entity';
import { PortalConfigService } from './portal-config.service';
import { PortalConfigController } from './portal-config.controller';

// Portal del Cliente. Por ahora solo su administración desde el ERP; la superficie
// que consume el abonado (auth propia, facturas, WiFi) se añade en fases siguientes.
//
// Esta parte NO es degradable: solo depende de la BD principal. Las secciones que
// dependan de GenieACS/OLT/MikroTik sí nacerán degradadas cuando se construyan.
@Module({
  imports: [TypeOrmModule.forFeature([PortalConfig, PortalBanner])],
  controllers: [PortalConfigController],
  providers: [PortalConfigService],
  exports: [PortalConfigService],
})
export class PortalModule {}
