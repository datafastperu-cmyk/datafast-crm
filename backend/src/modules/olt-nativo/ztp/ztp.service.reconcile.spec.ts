jest.mock('../../../common/utils/encryption.util', () => ({
  encrypt: (s: string) => `enc(${s})`,
  decrypt: (s: string) => s,
}));

import { ZtpProvisioningService } from './ztp.service';

// ── Helpers de dobles ──────────────────────────────────────────────────────
function makeQb(rows: any[]) {
  const qb: any = {};
  qb.where = jest.fn(() => qb);
  qb.andWhere = jest.fn(() => qb);
  qb.getMany = jest.fn(async () => rows);
  return qb;
}

describe('ZtpProvisioningService.reconcile', () => {
  let repo: any;
  let ds: any;
  let driver: any;
  let onuConfig: any;
  let svc: ZtpProvisioningService;

  beforeEach(() => {
    repo = { findOne: jest.fn(), update: jest.fn(), createQueryBuilder: jest.fn() };
    ds = { query: jest.fn() };
    driver = {};
    onuConfig = { ensureConnReq: jest.fn().mockResolvedValue({}) };
    svc = new ZtpProvisioningService(ds, repo, driver, onuConfig);
  });

  it('solo re-aplica los contratos con drift y agrega ok/fallidas', async () => {
    const drift = [
      { contratoId: 'c1', empresaId: 'e1' },
      { contratoId: 'c2', empresaId: 'e1' },
    ];
    repo.createQueryBuilder.mockReturnValue(makeQb(drift));

    // Aísla la orquestación pesada: mockeamos provisionContract.
    const spy = jest.spyOn(svc, 'provisionContract')
      .mockResolvedValueOnce({ ok: true,  mensaje: 'ok c1' } as any)
      .mockResolvedValueOnce({ ok: false, mensaje: 'fail c2' } as any);

    const r = await svc.reconcile('e1');

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith('c1', 'e1');
    expect(r.conDrift).toBe(2);
    expect(r.ok).toBe(1);
    expect(r.fallidas).toBe(1);
    expect(r.detalle).toHaveLength(2);
  });

  it('una excepción en un contrato no aborta el barrido (cuenta como fallida)', async () => {
    const drift = [
      { contratoId: 'c1', empresaId: 'e1' },
      { contratoId: 'c2', empresaId: 'e1' },
    ];
    repo.createQueryBuilder.mockReturnValue(makeQb(drift));
    jest.spyOn(svc, 'provisionContract')
      .mockRejectedValueOnce(new Error('GenieACS caído'))
      .mockResolvedValueOnce({ ok: true, mensaje: 'ok c2' } as any);

    const r = await svc.reconcile('e1');
    expect(r.ok).toBe(1);
    expect(r.fallidas).toBe(1);
    expect(r.detalle[0]).toMatchObject({ contratoId: 'c1', ok: false });
  });

  it('sin drift → no llama a provisionContract', async () => {
    repo.createQueryBuilder.mockReturnValue(makeQb([]));
    const spy = jest.spyOn(svc, 'provisionContract');
    const r = await svc.reconcile();
    expect(spy).not.toHaveBeenCalled();
    expect(r.conDrift).toBe(0);
  });
});

describe('ZtpProvisioningService.provisionContract — estado aplicado', () => {
  let repo: any;
  let ds: any;
  let driver: any;
  let onuConfig: any;
  let svc: ZtpProvisioningService;

  const cfgBase = {
    id: 'cfg1', contratoId: 'c1', empresaId: 'e1',
    provisioningEnabled: true, revision: 5,
    wifiEnabled: true, wifiSsid: 'DATAFAST-7777', wifiPassword: 'clave',
    wifi5gSsid: null, wifi5gPassword: null,
    voipEnabled: false, voipUser: null, voipPassword: null,
  };

  beforeEach(() => {
    repo = { findOne: jest.fn().mockResolvedValue(cfgBase), update: jest.fn() };
    // contratos (pppoe), ftth_onu_registro (wan_mode) y ftth_onu_registro (sn)
    ds = {
      // Orden real en provisionContract: (1) sn, (2) contratos, (3) wan_mode.
      query: jest.fn()
        .mockResolvedValueOnce([{ sn: 'HWTC12345678' }])
        .mockResolvedValueOnce([{ usuario_pppoe: null, password_pppoe: null, vlan_id: null }])
        .mockResolvedValueOnce([{ wan_mode: 'bridge' }]),
    };
    driver = {
      isReady: () => true,
      findDeviceIdBySerial: jest.fn().mockResolvedValue('dev1'),
      getRuntime: jest.fn().mockResolvedValue({ productClass: 'EG8145V5' }),
      applyExecutionPlan: jest.fn(),
    };
    onuConfig = { ensureConnReq: jest.fn().mockResolvedValue({}) };
    svc = new ZtpProvisioningService(ds, repo, driver, onuConfig);
  });

  it('plan 100% OK → persiste last_applied_revision = revision', async () => {
    driver.applyExecutionPlan.mockResolvedValue({
      applied: 1, results: [{ key: 'wifi.ssid', ok: true, path: 'p' }],
    });
    const r = await svc.provisionContract('c1', 'e1');

    expect(r.ok).toBe(true);
    const upd = repo.update.mock.calls[0][1];
    expect(upd.lastAppliedRevision).toBe(5);
    expect(upd.lastProvisionedAt).toBeInstanceOf(Date);
  });

  it('plan parcial (alguna falla) → NO fija last_applied_revision (sigue en drift)', async () => {
    driver.applyExecutionPlan.mockResolvedValue({
      applied: 1,
      results: [
        { key: 'wifi.ssid', ok: true,  path: 'p' },
        { key: 'wifi.password', ok: false, fault: 'cwmp.9003' },
      ],
    });
    const r = await svc.provisionContract('c1', 'e1');

    expect(r.ok).toBe(false);
    const upd = repo.update.mock.calls[0][1];
    expect(upd.lastAppliedRevision).toBeUndefined();
    expect(upd.lastProvisionedAt).toBeInstanceOf(Date);
  });

  it('provisioning_enabled=false → skip, no toca la ONU ni persiste', async () => {
    repo.findOne.mockResolvedValue({ ...cfgBase, provisioningEnabled: false });
    const r = await svc.provisionContract('c1', 'e1');
    expect(r.skipped).toBe(true);
    expect(driver.applyExecutionPlan).not.toBeCalled();
    expect(repo.update).not.toBeCalled();
  });
});
