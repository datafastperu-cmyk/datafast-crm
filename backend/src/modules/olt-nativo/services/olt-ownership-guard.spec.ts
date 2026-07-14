import { ConflictException, NotFoundException } from '@nestjs/common';
import { OltTrafficTableService } from './olt-traffic-table.service';
import { OltVlanService } from './olt-vlan.service';

// Incremento 7 — guards de ownership: el ERP nunca muta en hardware recursos
// cuyo origen no sea 'erp' (VLANs/traffic-tables preexistentes o de SmartOLT).

describe('Ownership guards (Incremento 7)', () => {
  describe('OltTrafficTableService', () => {
    const makeService = (tt: unknown) => {
      const repo = { findOne: jest.fn().mockResolvedValue(tt), update: jest.fn() };
      return new OltTrafficTableService(
        repo as never, {} as never, {} as never, {} as never, {} as never,
      );
    };

    it('editarConCli rechaza traffic table de origen externo', async () => {
      const svc = makeService({ id: 'x', trafficId: 10, nombre: 'SMARTOLT-50M', origen: 'olt' });
      await expect(
        svc.editarConCli('olt-1', 'emp-1', 10, { nombre: 'a', cirKbps: 1024, pirKbps: 1024 }),
      ).rejects.toThrow(ConflictException);
    });

    it('eliminarConCli rechaza traffic table de origen externo', async () => {
      const svc = makeService({ id: 'x', trafficId: 10, nombre: 'SMARTOLT-50M', origen: 'olt' });
      await expect(svc.eliminarConCli('olt-1', 'emp-1', 10)).rejects.toThrow(ConflictException);
    });

    it('eliminarConCli sigue lanzando NotFound si no existe', async () => {
      const svc = makeService(null);
      await expect(svc.eliminarConCli('olt-1', 'emp-1', 99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('OltVlanService', () => {
    it('eliminarConCli rechaza VLAN de origen externo', async () => {
      const repo = {
        findOne: jest.fn().mockResolvedValue({ id: 'v1', vlanId: 100, origen: 'olt' }),
      };
      const svc = new OltVlanService(repo as never, {} as never, {} as never, {} as never, {} as never);
      await expect(svc.eliminarConCli('olt-1', 'emp-1', 100)).rejects.toThrow(ConflictException);
    });
  });
});
