import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';

import { OltNativoModule } from '../olt-nativo/olt-nativo.module';
import { TicketsModule } from '../tickets/tickets.module';
import { MikrotikModule } from '../mikrotik/mikrotik.module';
import { FacturacionModule } from '../facturacion/facturacion.module';

import { Cliente } from '../clientes/entities/cliente.entity';
import { PortalConfig } from './entities/portal-config.entity';
import { PortalBanner } from './entities/portal-banner.entity';
import { PortalConfigService } from './portal-config.service';
import { PortalConfigController } from './portal-config.controller';
import { PortalAuthService } from './portal-auth.service';
import { PortalClienteService } from './portal-cliente.service';
import { PortalFacturacionService } from './portal-facturacion.service';
import { PortalOnuService } from './portal-onu.service';
import { PortalConsumoService } from './portal-consumo.service';
import { PortalSoporteService } from './portal-soporte.service';
import { PortalPlanesService } from './portal-planes.service';
import { ConsumoColectorService } from './consumo-colector.service';
import { ConsumoColectorCron } from './consumo-colector.cron';
import { PortalTenantService } from './portal-tenant.service';
import { PortalController } from './portal.controller';
import { PortalJwtGuard } from './portal-auth.guard';

// Portal del Cliente: administración desde el ERP + la superficie que consume el abonado.
//
// Degradación por sección, no por módulo. Autenticación, perfil, servicios y facturación
// solo dependen de la BD principal y no pueden caerse por hardware. WiFi y dispositivos
// dependen de GenieACS y de la OLT: cuando ese plano no está disponible, esas secciones
// responden "no disponible" con motivo, y el resto del portal sigue funcionando. Un ACS
// caído no deja al abonado sin ver su deuda.
@Module({
  imports: [
    TypeOrmModule.forFeature([PortalConfig, PortalBanner, Cliente]),
    // Sin secreto por defecto: cada firma y cada verificación pasan PORTAL_JWT_SECRET
    // explícitamente. Así un descuido de configuración no acaba emitiendo tokens de
    // abonado firmados con el secreto del ERP.
    JwtModule.register({}),
    // El portal reutiliza el plano TR-069 y el carril bajo demanda del modulo OLT:
    // no reimplementa nada del plano de red.
    OltNativoModule,
    // El portal abre tickets reutilizando la numeracion y el esquema de soporte.
    TicketsModule,
    // Colector de consumo: lee los contadores de las simple queues.
    MikrotikModule,
    // La fecha de corte que ve el abonado sale de la MISMA política que la usa el cron
    // que corta: si el portal la calculara por su cuenta, volverían a divergir.
    FacturacionModule,
  ],
  controllers: [PortalConfigController, PortalController],
  providers: [
    PortalConfigService,
    PortalAuthService,
    PortalClienteService,
    PortalFacturacionService,
    PortalOnuService,
    PortalConsumoService,
    PortalSoporteService,
    PortalPlanesService,
    ConsumoColectorService,
    ConsumoColectorCron,
    PortalTenantService,
    PortalJwtGuard,
  ],
  exports: [PortalConfigService],
})
export class PortalModule {}
