import { evaluarCompatibilidadModelo } from './olt-model-catalog';

// Catálogo de compatibilidad modelo+firmware — clasifica errores CLI:
// si el firmware no está validado, la primera hipótesis ante un error
// es incompatibilidad, no bug del driver.

describe('evaluarCompatibilidadModelo', () => {
  it('MA5800-X7 con el firmware de producción: validado (ignora el patch)', () => {
    const ev = evaluarCompatibilidadModelo('huawei', 'MA5800-X7', 'MA5800V100R018C00/SPH613');
    expect(ev.nivel).toBe('validado');
  });

  it('MA5800-X7 con firmware distinto: firmware_no_probado', () => {
    const ev = evaluarCompatibilidadModelo('huawei', 'MA5800-X7', 'MA5800V100R019C10');
    expect(ev.nivel).toBe('firmware_no_probado');
    expect(ev.mensaje).toContain('incompatibilidad');
  });

  it('MA5800-X7 sin firmware detectado: firmware_no_probado', () => {
    expect(evaluarCompatibilidadModelo('huawei', 'MA5800-X7', null).nivel).toBe('firmware_no_probado');
  });

  it('modelo experimental (MA5800-X15): experimental', () => {
    expect(evaluarCompatibilidadModelo('huawei', 'MA5800-X15', 'MA5800V100R018C00').nivel).toBe('experimental');
  });

  it('modelo fuera de catálogo: no_soportado', () => {
    expect(evaluarCompatibilidadModelo('huawei', 'MA5603T', 'X').nivel).toBe('no_soportado');
  });

  it('marca sin modelos (zte): no_soportado', () => {
    expect(evaluarCompatibilidadModelo('zte', 'C320', 'X').nivel).toBe('no_soportado');
  });

  it('matching case-insensitive de modelo y marca', () => {
    const ev = evaluarCompatibilidadModelo('HUAWEI', 'ma5800-x7', 'ma5800v100r018c00');
    expect(ev.nivel).toBe('validado');
  });
});
