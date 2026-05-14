import { Injectable, Logger } from '@nestjs/common';

export interface SystemInfo {
  sysDescr:    string;
  sysUpTime:   number;
  sysName:     string;
  cpuUsage?:   number;
  memoryUsage?: number;
}

export interface InterfaceStats {
  index:       number;
  description: string;
  speed:       number;
  operStatus:  number;
  rxBytes:     number;
  txBytes:     number;
}

@Injectable()
export class SnmpService {
  private readonly logger = new Logger(SnmpService.name);

  async getSystemInfo(host: string, community = 'public', version = 2): Promise<SystemInfo | null> {
    try {
      const session = await this._createSession(host, community, version);
      if (!session) return null;
      const result = await this._get(session, ['1.3.6.1.2.1.1.1.0','1.3.6.1.2.1.1.3.0','1.3.6.1.2.1.1.5.0']);
      session.close();
      return {
        sysDescr:  result['1.3.6.1.2.1.1.1.0'] ?? '',
        sysUpTime: Number(result['1.3.6.1.2.1.1.3.0'] ?? 0),
        sysName:   result['1.3.6.1.2.1.1.5.0'] ?? host,
      };
    } catch (err) {
      this.logger.warn(`SNMP error en ${host}: ${err.message}`);
      return null;
    }
  }

  async getCpuMemory(host: string, community = 'public', version = 2): Promise<{ cpu: number | null; memory: number | null }> {
    return { cpu: null, memory: null };
  }

  async getInterfaces(host: string, community = 'public', version = 2): Promise<InterfaceStats[]> {
    return [];
  }

  async testConnection(host: string, community = 'public', version = 2): Promise<boolean> {
    const info = await this.getSystemInfo(host, community, version);
    return info !== null;
  }

  private async _createSession(host: string, community: string, version: number): Promise<any> {
    try {
      const snmp = await import('net-snmp').catch(() => null);
      if (!snmp) return null;
      const v = version === 1 ? snmp.Version1 : snmp.Version2c;
      return snmp.createSession(host, community, { version: v, timeout: 5000 });
    } catch { return null; }
  }

  private _get(session: any, oids: string[]): Promise<Record<string, any>> {
    return new Promise((resolve, reject) => {
      session.get(oids, (err: any, varbinds: any[]) => {
        if (err) { reject(err); return; }
        const r: Record<string, any> = {};
        for (const vb of varbinds) r[vb.oid] = vb.value?.toString() ?? null;
        resolve(r);
      });
    });
  }
}
