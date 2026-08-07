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

// Reúne todas las condiciones que el barrido añadió al query builder, para poder
// afirmar sobre el FILTRO y no solo sobre el resultado: el riesgo de la migración
// masiva no está en lo que el barrido hace con las filas, sino en cuáles selecciona.
function condicionesDe(qb: any): string {
  return [
    ...qb.where.mock.calls.map((c: any[]) => String(c[0])),
    ...qb.andWhere.mock.calls.map((c: any[]) => String(c[0])),
  ].join(' | ');
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
    svc = new ZtpProvisioningService(ds, repo, driver, onuConfig, { isEnabled: () => false } as never);
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

  // ── Riesgo de migración masiva de ONUs (ADR-014) ──────────────────────────
  // Una ONU incorporada por migración queda con last_applied_revision IS NULL, que es
  // justo el filtro del barrido. Sin el guard por origen, el reconcile le reescribe
  // SSID, clave WiFi y credenciales de acceso web con el preset de la OLT: cientos de
  // clientes reales, con años de configuración propia, sin internet a la mañana
  // siguiente. El guard debe estar en el FILTRO, no en el cuerpo del bucle.
  it('solo barre ONUs de origen erp — nunca adoptadas ni migradas (reescritura masiva de WiFi, ADR-014)', async () => {
    const qb = makeQb([]);
    repo.createQueryBuilder.mockReturnValue(qb);

    await svc.reconcile('e1');

    expect(condicionesDe(qb)).toContain(`c.origen = 'erp'`);
  });
});

describe('ZtpProvisioningService.reconcilePendingReinjection', () => {
  let repo: any;
  let svc: ZtpProvisioningService;

  beforeEach(() => {
    repo = { findOne: jest.fn(), update: jest.fn(), createQueryBuilder: jest.fn() };
    svc = new ZtpProvisioningService(
      { query: jest.fn() } as any, repo, {} as any,
      { ensureConnReq: jest.fn().mockResolvedValue({}) } as any,
      { isEnabled: () => false } as never,
    );
  });

  // Este watcher corre CADA 2 MINUTOS y su filtro es exactamente el estado de una ONU
  // recién migrada. Es el camino por el que el daño llegaría antes — no el nocturno de
  // las 03:30. Si este guard desaparece, una migración no tiene una noche de margen:
  // tiene dos minutos.
  it('solo re-inyecta ONUs de origen erp — el watcher de 2 min es el que llega primero (ADR-014)', async () => {
    const qb = makeQb([]);
    repo.createQueryBuilder.mockReturnValue(qb);

    await svc.reconcilePendingReinjection();

    expect(condicionesDe(qb)).toContain(`c.origen = 'erp'`);
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
    origen: 'erp' as const,
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
    svc = new ZtpProvisioningService(ds, repo, driver, onuConfig, { isEnabled: () => false } as never);
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

  // Defensa en profundidad: los barridos ya filtran por origen, pero este método también
  // lo invoca el operador a mano. La configuración de una ONU adoptada es del abonado.
  it('origen adoptada → skip: no se reescribe la config del abonado por omisión (ADR-014)', async () => {
    repo.findOne.mockResolvedValue({ ...cfgBase, origen: 'adoptada' });
    const r = await svc.provisionContract('c1', 'e1');
    expect(r.skipped).toBe(true);
    expect(r.mensaje).toContain('adoptada');
    expect(driver.applyExecutionPlan).not.toBeCalled();
    expect(repo.update).not.toBeCalled();
  });

  it('origen migrada → skip por omisión, pero el operador puede sobrescribir deliberadamente', async () => {
    repo.findOne.mockResolvedValue({ ...cfgBase, origen: 'migrada' });
    driver.applyExecutionPlan.mockResolvedValue({
      applied: 1, results: [{ key: 'wifi.ssid', ok: true, path: 'p' }],
    });

    const sinPermiso = await svc.provisionContract('c1', 'e1');
    expect(sinPermiso.skipped).toBe(true);
    expect(driver.applyExecutionPlan).not.toBeCalled();

    const conPermiso = await svc.provisionContract('c1', 'e1', { sobrescribirConfigAjena: true });
    expect(conPermiso.ok).toBe(true);
    expect(driver.applyExecutionPlan).toBeCalled();
  });
});
