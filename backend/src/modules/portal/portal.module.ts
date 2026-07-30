import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';

import { Cliente } from '../clientes/entities/cliente.entity';
import { PortalConfig } from './entities/portal-config.entity';
import { PortalBanner } from './entities/portal-banner.entity';
import { PortalConfigService } from './portal-config.service';
import { PortalConfigController } from './portal-config.controller';
import { PortalAuthService } from './portal-auth.service';
import { PortalClienteService } from './portal-cliente.service';
import { PortalTenantService } from './portal-tenant.service';
import { PortalController } from './portal.controller';
import { PortalJwtGuard } from './portal-auth.guard';

// Portal del Cliente. Por ahora solo su administración desde el ERP; la superficie
// que consume el abonado (auth propia, facturas, WiFi) se añade en fases siguientes.
//
// Esta parte NO es degradable: solo depende de la BD principal. Las secciones que
// dependan de GenieACS/OLT/MikroTik sí nacerán degradadas cuando se construyan.
@Module({
  imports: [
    TypeOrmModule.forFeature([PortalConfig, PortalBanner, Cliente]),
    // Sin secreto por defecto: cada firma y cada verificación pasan PORTAL_JWT_SECRET
    // explícitamente. Así un descuido de configuración no acaba emitiendo tokens de
    // abonado firmados con el secreto del ERP.
    JwtModule.register({}),
  ],
  controllers: [PortalConfigController, PortalController],
  providers: [
    PortalConfigService,
    PortalAuthService,
    PortalClienteService,
    PortalTenantService,
    PortalJwtGuard,
  ],
  exports: [PortalConfigService],
})
export class PortalModule {}
