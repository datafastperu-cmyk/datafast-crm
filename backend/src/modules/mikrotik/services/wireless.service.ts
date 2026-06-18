import { Injectable } from '@nestjs/common';
import { RouterConnectionPool, RouterCredentials } from './connection-pool.service';

@Injectable()
export class WirelessService {
  constructor(private readonly pool: RouterConnectionPool) {}

  private normalizeMac(mac: string): string {
    return mac.toUpperCase().replace(/[^A-F0-9]/g, '').match(/.{2}/g)!.join(':');
  }

  async agregarMacAccessList(creds: RouterCredentials, mac: string, comment: string): Promise<void> {
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
  }

  async eliminarMacAccessList(creds: RouterCredentials, mac: string): Promise<number> {
    const macFmt = this.normalizeMac(mac);
    return this.pool.execute(creds, async (api) => {
      const entries = await api.write('/interface/wireless/access-list/print', [
        `?mac-address=${macFmt}`,
      ]);
      for (const e of entries) {
        await api.write('/interface/wireless/access-list/remove', [`=.id=${e['.id']}`]);
      }
      return entries.length;
    });
  }
}
