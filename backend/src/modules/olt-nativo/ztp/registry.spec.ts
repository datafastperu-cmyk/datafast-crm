import { matchDeviceProfile, getParameterMap } from './registry';

describe('registry — matchDeviceProfile', () => {
  it('casa el EG8145V5 por ProductClass', () => {
    const p = matchDeviceProfile({ productClass: 'EG8145V5', softwareVersion: 'V5R020C10S195' });
    expect(p?.vendor).toBe('Huawei');
    expect(p?.model).toBe('EG8145V5');
    expect(p?.parameter_map).toBe('huawei_igd_v1');
  });

  it('modelo desconocido → null (no sobre-empareja)', () => {
    expect(matchDeviceProfile({ productClass: 'ZTE-F660' })).toBeNull();
  });

  it('runtime sin identidad fuerte (ni model ni productClass) → null', () => {
    expect(matchDeviceProfile({ manufacturer: 'Huawei Technologies Co.,Ltd' })).toBeNull();
  });
});

describe('registry — getParameterMap', () => {
  it('devuelve el map registrado', () => {
    expect(getParameterMap('huawei_igd_v1')?.data_model).toBe('InternetGatewayDevice');
  });
  it('map inexistente → null', () => {
    expect(getParameterMap('inexistente_v9')).toBeNull();
  });
});
