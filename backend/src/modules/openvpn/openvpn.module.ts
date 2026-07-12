import { Module }        from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OpenvpnConfig }         from './entities/openvpn-config.entity';
import { VpnCliente }            from './entities/vpn-cliente.entity';
import { VpnAlerta }             from './entities/vpn-alerta.entity';
import { OpenvpnService }        from './openvpn.service';
import { VpnClienteService }     from './services/vpn-cliente.service';
import { OpenvpnController }     from './openvpn.controller';
import { VpnClienteController }  from './vpn-cliente.controller';
import { Router }                from '../mikrotik/entities/router.entity';
import { ConfiguracionModule }   from '../config/config.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([OpenvpnConfig, VpnCliente, VpnAlerta, Router]),
    ConfiguracionModule,
  ],
  controllers: [OpenvpnController, VpnClienteController],
  providers:   [OpenvpnService, VpnClienteService],
  exports:     [OpenvpnService, VpnClienteService],
})
export class OpenvpnModule {}
