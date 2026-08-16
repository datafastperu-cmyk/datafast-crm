import { VpnClienteService } from './vpn-cliente.service';

// Ola 1, grupo 3a (2026-08-16) — conversión de 4 operaciones consumidas por
// MikrotikService (técnico→técnico, D-41: solo se toca el borde, nunca la lógica
// interna de OpenVPN). El caso que motiva la ola en este lote: `revocar()` distinguía
// "ya revocado" haciendo arqueología sobre el status/constructor de la excepción
// (`err?.status === 409 || err?.constructor?.name === 'ConflictException'`) en el
// llamador — exactamente lo que D-14 prohíbe. `ya_en_destino` lo reemplaza.
describe('VpnClienteService.revocar() — clasificación por rama', () => {
  const hacer = (over: Record<string, unknown> = {}) => {
    const svc = Object.create(VpnClienteService.prototype) as any;
    svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    svc.repo = { update: jest.fn() };
    svc._getCliente = jest.fn(async () => ({ id: 'c-1', estado: 'activo', vpnUsuario: 'df-r1-abc', nombreCert: 'user-r1-abc' }));
    svc.killClienteVpnManagement = jest.fn(async () => {});
    Object.assign(svc, over);
    return svc;
  };

  it('aplicado: cliente activo se revoca', async () => {
    const svc = hacer();
    const r = await svc.revocar('c-1', 'e-1');
    expect(r.clase).toBe('aplicado');
  });

  it('ya_en_destino: cliente ya estaba revocado — no arqueología sobre status HTTP', async () => {
    const svc = hacer({
      _getCliente: jest.fn(async () => ({ id: 'c-1', estado: 'revocado', vpnUsuario: 'df-r1' })),
    });
    const r = await svc.revocar('c-1', 'e-1');
    expect(r.clase).toBe('ya_en_destino');
  });

  // VIO hacia adentro (E03-05): `ya_en_destino` afirma que el CCD está borrado y la sesión
  // muerta, no que la fila dice 'revocado'. Sin esto, un cert marcado revocado en BD con su
  // CCD todavía presente seguiría reservando la IP mientras el llamador lee ÉXITO.
  it('ya_en_destino: también mata la sesión — no se limita a leer el flag de BD', async () => {
    const killClienteVpnManagement = jest.fn(async () => {});
    const svc = hacer({
      _getCliente: jest.fn(async () => ({ id: 'c-1', estado: 'revocado', vpnUsuario: 'df-r1' })),
      killClienteVpnManagement,
    });
    await svc.revocar('c-1', 'e-1');
    expect(killClienteVpnManagement).toHaveBeenCalledWith('df-r1');
  });

  it('rechazado_definitivo: cliente no encontrado (NotFoundException vía clasificarError)', async () => {
    const svc = hacer({
      _getCliente: jest.fn(async () => { throw new (require('@nestjs/common').NotFoundException)('no existe'); }),
    });
    const r = await svc.revocar('c-x', 'e-1');
    expect(r.clase).toBe('rechazado_definitivo');
  });

  it('el error inesperado no lanza: cae en clasificarError vía el catch', async () => {
    const svc = hacer({ killClienteVpnManagement: jest.fn(async () => { throw new Error('management caído'); }) });
    await expect(svc.revocar('c-1', 'e-1')).resolves.toHaveProperty('clase');
  });
});

describe('VpnClienteService.generarParaRouter() — clasificación por rama', () => {
  const router: any = { id: 'r-1', empresaId: 'e-1', nombre: 'Router Sur', subnetsLocales: [], vpnIp: null, ipGestion: '10.0.0.1' };

  const hacer = (over: Record<string, unknown> = {}) => {
    const svc = Object.create(VpnClienteService.prototype) as any;
    svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    svc.repo = { findOne: jest.fn(async () => null), create: jest.fn((d: any) => d), save: jest.fn(async () => {}) };
    svc.routerRepo = { update: jest.fn() };
    svc.escribirArchivoCcd = jest.fn(async () => {});
    Object.assign(svc, over);
    return svc;
  };

  it('aplicado: reutiliza cliente existente y solo actualiza el CCD', async () => {
    const svc = hacer({
      repo: { findOne: jest.fn(async () => ({ vpnUsuario: 'df-existing' })), create: jest.fn(), save: jest.fn() },
    });
    const r = await svc.generarParaRouter(router);
    expect(r.clase).toBe('aplicado');
    expect(svc.escribirArchivoCcd).toHaveBeenCalledWith('df-existing', [], '10.0.0.1');
  });

  it('aplicado: crea un cliente VPN nuevo', async () => {
    const svc = hacer();
    const r = await svc.generarParaRouter(router);
    expect(r.clase).toBe('aplicado');
    expect(svc.repo.save).toHaveBeenCalled();
  });

  it('el error inesperado no lanza: cae en clasificarError vía el catch', async () => {
    const svc = hacer({ repo: { findOne: jest.fn(async () => { throw new Error('BD caída'); }) } });
    await expect(svc.generarParaRouter(router)).resolves.toHaveProperty('clase');
  });
});

describe('VpnClienteService.vincularCertWizardARouter() — clasificación por rama', () => {
  const hacer = (over: Record<string, unknown> = {}) => {
    const svc = Object.create(VpnClienteService.prototype) as any;
    svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    svc.repo = {
      findOne: jest.fn(async () => ({ id: 'c-1', estado: 'activo', vpnUsuario: 'df-r1', nombreCert: 'user-r1' })),
      update: jest.fn(),
    };
    svc.routerRepo = { findOne: jest.fn(async () => ({ id: 'r-1', subnetsLocales: [], vpnIp: null, ipGestion: '10.0.0.1' })), update: jest.fn() };
    svc.escribirArchivoCcd = jest.fn(async () => {});
    svc.generarParaRouter = jest.fn(async () => ({ clase: 'aplicado', mensaje: 'fallback ok' }));
    Object.assign(svc, over);
    return svc;
  };

  it('aplicado: cert del wizard vinculado directamente', async () => {
    const svc = hacer();
    const r = await svc.vincularCertWizardARouter('vc-1', 'r-1', 'e-1', 'u-1');
    expect(r.clase).toBe('aplicado');
    expect(svc.generarParaRouter).not.toHaveBeenCalled();
  });

  it('delega en generarParaRouter cuando el cert no aplica (no encontrado/revocado/otro usuario)', async () => {
    const svc = hacer({ repo: { findOne: jest.fn(async () => null), update: jest.fn() } });
    const r = await svc.vincularCertWizardARouter('vc-x', 'r-1', 'e-1');
    expect(svc.generarParaRouter).toHaveBeenCalled();
    expect(r.clase).toBe('aplicado');
  });

  it('no_aplica: cert no aplica y el router del fallback tampoco existe', async () => {
    const svc = hacer({
      repo: { findOne: jest.fn(async () => null), update: jest.fn() },
      routerRepo: { findOne: jest.fn(async () => null), update: jest.fn() },
    });
    const r = await svc.vincularCertWizardARouter('vc-x', 'r-x', 'e-1');
    expect(r.clase).toBe('no_aplica');
    expect(svc.generarParaRouter).not.toHaveBeenCalled();
  });

  it('el error inesperado no lanza: cae en clasificarError vía el catch', async () => {
    const svc = hacer({ repo: { findOne: jest.fn(async () => { throw new Error('BD caída'); }), update: jest.fn() } });
    await expect(svc.vincularCertWizardARouter('vc-1', 'r-1', 'e-1')).resolves.toHaveProperty('clase');
  });
});

describe('VpnClienteService.matarSesionImpostora() — clasificación por rama', () => {
  const hacer = (over: Record<string, unknown> = {}) => {
    const svc = Object.create(VpnClienteService.prototype) as any;
    svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    svc.repo = { findOne: jest.fn(async () => ({ vpnUsuario: 'df-r1', nombreCert: 'user-r1' })) };
    svc._leerManagement = jest.fn(async () => [{ commonName: 'df-r1' }]);
    svc.killClienteVpnManagement = jest.fn(async () => {});
    Object.assign(svc, over);
    return svc;
  };

  it('aplicado: sesión impostora terminada', async () => {
    const svc = hacer();
    const r = await svc.matarSesionImpostora('r-1', 'e-1');
    expect(r.clase).toBe('aplicado');
  });

  it('no_aplica: sin cliente VPN activo para el router', async () => {
    const svc = hacer({ repo: { findOne: jest.fn(async () => null) } });
    const r = await svc.matarSesionImpostora('r-1', 'e-1');
    expect(r.clase).toBe('no_aplica');
  });

  it('no_aplica: no hay sesión activa que corresponda al CN', async () => {
    const svc = hacer({ _leerManagement: jest.fn(async () => []) });
    const r = await svc.matarSesionImpostora('r-1', 'e-1');
    expect(r.clase).toBe('no_aplica');
  });

  it('el error inesperado no lanza: cae en clasificarError vía el catch', async () => {
    const svc = hacer({ _leerManagement: jest.fn(async () => { throw new Error('management caído'); }) });
    await expect(svc.matarSesionImpostora('r-1', 'e-1')).resolves.toHaveProperty('clase');
  });
});
