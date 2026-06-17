import { Module } from '@nestjs/common';
import { SmartoltModule }   from '../smartolt/smartolt.module';
import { OltNativoModule }  from '../olt-nativo/olt-nativo.module';
import { SmartoltProvider } from './providers/smartolt.provider';
import { NativoSshProvider } from './providers/nativo-ssh.provider';
import { NativoSnmpProvider } from './providers/nativo-snmp.provider';
import { OltProviderFactory } from './olt-provider.factory';

@Module({
  imports:   [SmartoltModule, OltNativoModule],
  providers: [SmartoltProvider, NativoSshProvider, NativoSnmpProvider, OltProviderFactory],
  exports:   [OltProviderFactory],
})
export class OltProviderModule {}
