import { Injectable } from '@nestjs/common';
import { RouterConnectionPool, RouterCredentials } from './connection-pool.service';
import { ResultadoOperacion, clasificarError } from '../../../common/domain/resultado-operacion';

@Injectable()
export class WirelessService {
  constructor(private readonly pool: RouterConnectionPool) {}

  private normalizeMac(mac: string): string {
    return mac.toUpperCase().replace(/[^A-F0-9]/g, '').match(/.{2}/g)!.join(':');
  }

  // Ola 1, grupo 3b (2026-08-16). Consumida por ContratosService (registrarEnAccessListAntena,
  // eliminarDeAccessListAntena — ambos con su propio try/catch previo) y
  // MonitoreoService.repararAntenaAP() (bucle con try/catch por contrato) — los tres
  // llamadores ya traducían la excepción a su propio contrato, ninguno queda a medias.
  async agregarMacAccessList(creds: RouterCredentials, mac: string, comment: string): Promise<ResultadoOperacion> {
    try {
      const macFmt = this.normalizeMac(mac);
      await this.pool.execute(creds, async (api) => {
        const existing = await api.write('/interface/wireless/access-list/print', [
          `?mac-address=${macFmt}`,
        ]);
        if (existing.length > 0) {
          await api.write('/interface/wireless/access-list/set', [
            `=.id=${existing[0]['.id']}`,
            `=comment=${comment}`,
          ]);
        } else {
          await api.write('/interface/wireless/access-list/add', [
            `=mac-address=${macFmt}`,
            `=comment=${comment}`,
          ]);
        }
      });
      return { clase: 'aplicado', mensaje: `MAC ${macFmt} registrada en Access List.` };
    } catch (err) {
      return clasificarError(err);
    }
  }

  async eliminarMacAccessList(creds: RouterCredentials, mac: string): Promise<ResultadoOperacion> {
    try {
      const macFmt = this.normalizeMac(mac);
      const removed = await this.pool.execute(creds, async (api) => {
        const entries = await api.write('/interface/wireless/access-list/print', [
          `?mac-address=${macFmt}`,
        ]);
        for (const e of entries) {
          await api.write('/interface/wireless/access-list/remove', [`=.id=${e['.id']}`]);
        }
        return entries.length;
      });
      if (removed === 0) {
        return { clase: 'ya_en_destino', mensaje: `MAC ${macFmt} no estaba en la Access List.` };
      }
      return { clase: 'aplicado', mensaje: `MAC ${macFmt} removida de la Access List (${removed} entrada(s)).` };
    } catch (err) {
      return clasificarError(err);
    }
  }
}
