import { Module } from '@nestjs/common';

import { AprovisionamientoController }   from './aprovisionamiento.controller';
import { MockProvisionamientoProvider }  from './providers/mock-provisionamiento.provider';
import { AuthModule }                    from '../auth/auth.module';

// Tras retirar el Orquestador FTTH legacy (Path A), este módulo solo expone:
//  - El endpoint de renotificación de bienvenida (emite el evento canónico).
//  - El PROVISIONAMIENTO_PROVIDER (mock) que consume el worker de cobranza.
@Module({
  imports: [AuthModule],
  controllers: [AprovisionamientoController],
  providers: [
    { provide: 'PROVISIONAMIENTO_PROVIDER', useClass: MockProvisionamientoProvider },
  ],
  exports: ['PROVISIONAMIENTO_PROVIDER'],
})
export class AprovisionamientoModule {}
