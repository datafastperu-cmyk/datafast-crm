import { BadRequestException, ConflictException } from '@nestjs/common';
import { OltBaselinePlanService } from './olt-baseline-plan.service';
import { OltBaseline } from '../entities/olt-baseline.entity';
import { InfrastructureSnapshot } from '../types/infrastructure-snapshot';

// Incremento 9 — Planning + Execution del baseline.

const olt = { id: 'olt-1', empresaId: 'e1', nombre: 'OLT TEST', baselineId: 'bl-1' };

const baseline = (spec: Partial<OltBaseline['spec']> = {}): OltBaseline => ({
  id: 'bl-1', empresaId: 'e1', nombre: 'Datafast', version: 1,
  descripcion: null, activo: true, createdAt: new Date(), updatedAt: new Date(),
  spec: {
    vlans:         [{ vlanId: 100, nombre: 'INTERNET' }],
    trafficTables: [{ nombre: 'ERP-100M', cirKbps: 102400, pirKbps: 102400 }],
    ...spec,
  },
} as OltBaseline);

const snapshot = (over: Partial<InfrastructureSnapshot> = {}): InfrastructureSnapshot => ({
  oltId: 'olt-1', oltNombre: 'OLT TEST', marca: 'huawei', modelo: null, firmware: null,
  boards: [], vlans: [], lineProfiles: [], serviceProfiles: [], trafficTables: [],
  opticalPorts: [], snmpCommunities: null, snmpVersions: null, ntpServers: null,
  ultimoSyncEn: new Date(), ultimoSyncEstado: 'completed', ultimoHealthEn: null,
  configSnapshotEn: null,
  ...over,
});

function makeService(opts: {
  bl?: OltBaseline | null;
  snap?: InfrastructureSnapshot;
  vlanService?: Record<string, jest.Mock>;
  ttService?: Record<string, jest.Mock>;
  oltRow?: Record<string, unknown> | null;
}) {
  const oltRepo      = { findOne: jest.fn().mockResolvedValue(opts.oltRow === undefined ? olt : opts.oltRow) };
  const baselineRepo = { findOne: jest.fn().mockResolvedValue(opts.bl === undefined ? baseline() : opts.bl) };
  const snapService  = { obtener: jest.fn().mockResolvedValue(opts.snap ?? snapshot()) };
  return new OltBaselinePlanService(
    oltRepo as never, baselineRepo as never, snapService as never,
    (opts.vlanService ?? {}) as never, (opts.ttService ?? {}) as never,
  );
}

describe('OltBaselinePlanService', () => {
  it('genera operaciones para VLANs y traffic tables faltantes, en orden', async () => {
    const svc  = makeService({});
    const plan = await svc.generarPlan('olt-1', 'e1');
    expect(plan.operaciones).toHaveLength(2);
    expect(plan.operaciones[0].tipo).toBe('crear_vlan');
    expect(plan.operaciones[1].tipo).toBe('crear_traffic_table');
    expect(plan.yaConverge).toBe(false);
    expect(plan.planHash).toHaveLength(64);
  });

  it('OLT ya convergida: plan vacío y yaConverge=true', async () => {
    const svc = makeService({
      snap: snapshot({
        vlans:         [{ vlanId: 100, nombre: 'INTERNET', origen: 'erp', estado: 'active' }],
        trafficTables: [{ trafficId: 21, nombre: 'ERP-100M', cirKbps: 102400, pirKbps: 102400, tipo: 'combinado' }],
      }),
    });
    const plan = await svc.generarPlan('olt-1', 'e1');
    expect(plan.operaciones).toHaveLength(0);
    expect(plan.yaConverge).toBe(true);
  });

  it('traffic table existente con CIR distinto: bloqueo, nunca operación automática', async () => {
    const svc = makeService({
      snap: snapshot({
        vlans:         [{ vlanId: 100, nombre: 'INTERNET', origen: 'erp', estado: 'active' }],
        trafficTables: [{ trafficId: 5, nombre: 'ERP-100M', cirKbps: 51200, pirKbps: 51200, tipo: 'combinado' }],
      }),
    });
    const plan = await svc.generarPlan('olt-1', 'e1');
    expect(plan.operaciones).toHaveLength(0);
    expect(plan.bloqueos).toHaveLength(1);
    expect(plan.yaConverge).toBe(false);
  });

  it('OLT sin baseline asignado: BadRequest', async () => {
    const svc = makeService({ oltRow: { ...olt, baselineId: null } });
    await expect(svc.generarPlan('olt-1', 'e1')).rejects.toThrow(BadRequestException);
  });

  it('aplicar con hash desactualizado: 409 sin ejecutar nada', async () => {
    const vlanService = { agregarConCli: jest.fn() };
    const svc = makeService({ vlanService });
    await expect(svc.aplicarPlan('olt-1', 'e1', 'hash-viejo')).rejects.toThrow(ConflictException);
    expect(vlanService.agregarConCli).not.toHaveBeenCalled();
  });

  it('aplicar ejecuta en orden y se detiene en el primer fallo', async () => {
    const vlanService = {
      agregarConCli: jest.fn().mockRejectedValue(new Error('CLI rechazó VLAN 100')),
    };
    const ttService = { agregarConCli: jest.fn() };
    const svc  = makeService({ vlanService, ttService });
    const plan = await svc.generarPlan('olt-1', 'e1');

    const res = await svc.aplicarPlan('olt-1', 'e1', plan.planHash);
    expect(res.completado).toBe(false);
    expect(res.ejecutadas).toBe(0);
    expect(res.resultados).toHaveLength(1);
    expect(ttService.agregarConCli).not.toHaveBeenCalled(); // nunca continúa a ciegas
  });

  it('aplicar feliz: ejecuta todas las operaciones y reporta completado', async () => {
    const vlanService = {
      agregarConCli: jest.fn().mockResolvedValue({ vlanId: 100 }),
    };
    const ttService = {
      agregarConCli: jest.fn().mockResolvedValue({ nombre: 'ERP-100M', trafficId: 22 }),
    };
    const svc  = makeService({ vlanService, ttService });
    const plan = await svc.generarPlan('olt-1', 'e1');

    const res = await svc.aplicarPlan('olt-1', 'e1', plan.planHash);
    expect(res.completado).toBe(true);
    expect(res.ejecutadas).toBe(2);
    expect(vlanService.agregarConCli).toHaveBeenCalledWith('olt-1', 'e1', { vlanId: 100, nombre: 'INTERNET' });
    expect(ttService.agregarConCli).toHaveBeenCalledWith('olt-1', 'e1', { nombre: 'ERP-100M', cirKbps: 102400, pirKbps: 102400 });
  });
});
