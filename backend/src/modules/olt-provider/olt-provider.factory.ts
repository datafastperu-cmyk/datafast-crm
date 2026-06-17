import { Injectable } from '@nestjs/common';
import { OltMetodoConexion } from '../olt-nativo/entities/olt-dispositivo.entity';
import { IOltProvider } from './interfaces/olt-provider.interface';
import { SmartoltProvider } from './providers/smartolt.provider';
import { NativoSshProvider } from './providers/nativo-ssh.provider';
import { NativoSnmpProvider } from './providers/nativo-snmp.provider';

@Injectable()
export class OltProviderFactory {
  constructor(
    private readonly smartolt:   SmartoltProvider,
    private readonly nativoSsh:  NativoSshProvider,
    private readonly nativoSnmp: NativoSnmpProvider,
  ) {}

  get(metodo: OltMetodoConexion): IOltProvider {
    switch (metodo) {
      case OltMetodoConexion.SMARTOLT_API: return this.smartolt;
      case OltMetodoConexion.NATIVO_SSH:  return this.nativoSsh;
      case OltMetodoConexion.NATIVO_SNMP: return this.nativoSnmp;
      default:
        throw new Error(`OltMetodoConexion desconocido: ${metodo as string}`);
    }
  }
}
