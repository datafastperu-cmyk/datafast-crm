import { GenieAcsDriver } from './genieacs.driver';
import { HUAWEI_IGD_V1 } from './parameter-maps/huawei-igd-v1';
import { ExecutionPlan, ParameterMap } from './ztp.contracts';

jest.setTimeout(15000); // el driver hace sleeps de ~1.5s entre intentos

const plan = (writes: ExecutionPlan['writes']): ExecutionPlan => ({
  device: 'dev', profile: 'Huawei_EG8145V5', writes,
  metadata: { revision: 1, generated_at: 'x', generated_by: 'Resolver' },
});
const noDiscovery: ParameterMap = { data_model: 'InternetGatewayDevice', map: {} };

describe('GenieAcsDriver.applyExecutionPlan', () => {
  let nbi: any;
  let driver: GenieAcsDriver;

  beforeEach(() => {
    nbi = {
      queueTask:   jest.fn(),
      getFaults:   jest.fn().mockResolvedValue([]),
      deleteFault: jest.fn().mockResolvedValue(undefined),
      deleteTask:  jest.fn().mockResolvedValue(undefined),
      getDevice:   jest.fn(),
      addTag:      jest.fn().mockResolvedValue(undefined),
      isConfigured: () => true,
    };
    driver = new GenieAcsDriver(nbi);
  });

  it('fallback: 1ª candidata da fault → prueba la 2ª y la usa', async () => {
    nbi.queueTask
      .mockResolvedValueOnce({ status: 200, body: { _id: 't1' } })
      .mockResolvedValueOnce({ status: 200, body: { _id: 't2' } });
    nbi.getFaults
      .mockResolvedValueOnce([{ _id: 'f1', code: 'cwmp.9003' }]) // task_t1 falla
      .mockResolvedValueOnce([]);                                 // task_t2 ok

    const res = await driver.applyExecutionPlan(
      plan([{ key: 'wifi.password', candidates: ['P1', 'P2'], value: 'x' }]), noDiscovery,
    );

    expect(nbi.queueTask).toHaveBeenCalledTimes(2);
    expect(nbi.deleteFault).toHaveBeenCalledWith('f1');
    expect(nbi.deleteTask).toHaveBeenCalledWith('t1');
    expect(res.applied).toBe(1);
    expect(res.results[0].ok).toBe(true);
    expect(res.results[0].path).toBe('P2');
    expect(nbi.addTag).toHaveBeenCalledWith('dev', 'Provisioned');
  });

  it('todas las candidatas fallan → write no-ok + tag ProvisionFailed', async () => {
    nbi.queueTask.mockResolvedValue({ status: 200, body: { _id: 't1' } });
    nbi.getFaults.mockResolvedValue([{ _id: 'f1', code: 'cwmp.9003' }]);

    const res = await driver.applyExecutionPlan(
      plan([{ key: 'k', candidates: ['A'], value: 'v' }]), noDiscovery,
    );

    expect(res.applied).toBe(0);
    expect(res.results[0].ok).toBe(false);
    expect(res.results[0].fault).toBe('cwmp.9003');
    expect(nbi.addTag).toHaveBeenCalledWith('dev', 'ProvisionFailed');
  });

  it('1ª candidata aplica sin fault → no reintenta', async () => {
    nbi.queueTask.mockResolvedValue({ status: 200, body: { _id: 't1' } });
    nbi.getFaults.mockResolvedValue([]);

    const res = await driver.applyExecutionPlan(
      plan([{ key: 'k', candidates: ['A', 'B'], value: 'v' }]), noDiscovery,
    );

    expect(nbi.queueTask).toHaveBeenCalledTimes(1);
    expect(res.results[0].path).toBe('A');
    expect(res.applied).toBe(1);
  });

  it('discovery: resuelve {ppp} al índice que contiene WANPPPConnection', async () => {
    nbi.getDevice.mockResolvedValue({
      InternetGatewayDevice: { WANDevice: { '1': { WANConnectionDevice: {
        '1': { WANIPConnection: {} },
        '4': { WANPPPConnection: {} },
      } } } },
    });
    nbi.queueTask
      .mockResolvedValueOnce({ status: 200, body: {} })          // refreshObject de discovery
      .mockResolvedValueOnce({ status: 200, body: { _id: 't1' } }); // setParameterValues
    nbi.getFaults.mockResolvedValue([]);

    const res = await driver.applyExecutionPlan(
      plan([{ key: 'internet.username',
              candidates: ['InternetGatewayDevice.WANDevice.1.WANConnectionDevice.{ppp}.WANPPPConnection.1.Username'],
              value: 'u' }]),
      HUAWEI_IGD_V1,
    );

    expect(res.applied).toBe(1);
    expect(res.results[0].path).toContain('WANConnectionDevice.4.WANPPPConnection.1.Username');
  });

  it('discovery no resuelto ({ppp} ausente) → write omitido', async () => {
    nbi.getDevice.mockResolvedValue({
      InternetGatewayDevice: { WANDevice: { '1': { WANConnectionDevice: {
        '1': { WANIPConnection: {} }, // ninguno con WANPPPConnection
      } } } },
    });
    nbi.queueTask.mockResolvedValue({ status: 200, body: {} }); // solo el refresh

    const res = await driver.applyExecutionPlan(
      plan([{ key: 'internet.username',
              candidates: ['InternetGatewayDevice.WANDevice.1.WANConnectionDevice.{ppp}.WANPPPConnection.1.Username'],
              value: 'u' }]),
      HUAWEI_IGD_V1,
    );

    expect(res.applied).toBe(0);
    expect(res.results[0].ok).toBe(false);
    expect(res.results[0].reason).toBe('placeholder-no-resuelto');
  });
});
