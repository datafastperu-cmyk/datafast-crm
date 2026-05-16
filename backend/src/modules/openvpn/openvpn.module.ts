import { Module }        from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OpenvpnConfig }    from './entities/openvpn-config.entity';
import { OpenvpnService }   from './openvpn.service';
import { OpenvpnController } from './openvpn.controller';

@Module({
  imports:     [TypeOrmModule.forFeature([OpenvpnConfig])],
  controllers: [OpenvpnController],
  providers:   [OpenvpnService],
  exports:     [OpenvpnService],
})
export class OpenvpnModule {}
