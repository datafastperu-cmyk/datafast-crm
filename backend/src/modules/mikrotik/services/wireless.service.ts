import { Injectable } from '@nestjs/common';
import { RouterConnectionPool, RouterCredentials } from './connection-pool.service';

@Injectable()
export class WirelessService {
  constructor(private readonly pool: RouterConnectionPool) {}

  async agregarMacAccessList(creds: RouterCredentials, mac: string, comment: string): Promise<void> {
    await this.pool.execute(creds, async (api) => {
      const existing = await api.write('/interface/wireless/access-list/print', [
        `?mac-address=${mac}`,
      ]);
      if (existing.length > 0) {
        await api.write('/interface/wireless/access-list/set', [
          `=.id=${existing[0]['.id']}`,
          `=comment=${comment}`,
        ]);
      } else {
        await api.write('/interface/wireless/access-list/add', [
          `=mac-address=${mac}`,
          `=comment=${comment}`,
        ]);
      }
    });
  }

  async eliminarMacAccessList(creds: RouterCredentials, mac: string): Promise<void> {
    await this.pool.execute(creds, async (api) => {
      const entries = await api.write('/interface/wireless/access-list/print', [
        `?mac-address=${mac}`,
      ]);
      for (const e of entries) {
        await api.write('/interface/wireless/access-list/remove', [`=.id=${e['.id']}`]);
      }
    });
  }
}
