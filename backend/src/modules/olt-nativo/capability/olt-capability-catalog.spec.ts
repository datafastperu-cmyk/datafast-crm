import { resolverCapacidadesOlt } from './olt-capability-catalog';
import { OltMarca } from '../entities/olt-dispositivo.entity';

describe('resolverCapacidadesOlt', () => {
  it('Huawei: soporta TR-069 DHCP43, SNMP y FEC', () => {
    const caps = resolverCapacidadesOlt(OltMarca.HUAWEI);
    expect(caps.tr069Dhcp43).toBe(true);
    expect(caps.snmp).toBe(true);
    expect(caps.fec).toBe(true);
  });

  it('Huawei: no asume IPv6 ni QinQ (no implementados)', () => {
    const caps = resolverCapacidadesOlt(OltMarca.HUAWEI);
    expect(caps.ipv6).toBe(false);
    expect(caps.vlanQinq).toBe(false);
  });

  it('marcas sin driver nativo: todas las capacidades en false', () => {
    for (const marca of [OltMarca.ZTE, OltMarca.VSOL, OltMarca.CDATA]) {
      const caps = resolverCapacidadesOlt(marca);
      expect(Object.values(caps).every(v => v === false)).toBe(true);
    }
  });
});
