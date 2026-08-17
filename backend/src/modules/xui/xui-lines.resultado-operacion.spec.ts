import { XuiLinesService } from './xui-lines.service';

// Ola 1, grupo 3b (2026-08-16) — conversión de las 4 operaciones IPTV consumidas por
// ContratosService (Core), único llamador — todas fire-and-forget o pasos de saga, ningún
// llamador lee el objeto XuiLine devuelto (verificado antes de convertir). El local (fila
// creada/actualizada) define `aplicado`: XUI está declarado módulo degradable (CLAUDE.md) —
// la sincronización HTTP sigue siendo best-effort con su propio contador de reintentos y el
// barrido de xui-monitor.service.ts (~10 min) como red de seguridad.
describe('XuiLinesService.crearLineParaContrato() — clasificación por rama', () => {
  const hacer = (over: Record<string, unknown> = {}) => {
    const svc = Object.create(XuiLinesService.prototype) as any;
    svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    svc.dataSource = {
      query: jest.fn(async (sql: string) => {
        if (/FROM servicios/.test(sql)) return [{ id: 'c-1', clienteId: 'cl-1', planId: 'p-1' }];
        if (/FROM planes/.test(sql)) return [{ id: 'p-1', cuentaIptv: true, sesionesIptv: 1, xuiBouquetIds: [] }];
        if (/FROM clientes/.test(sql)) return [{ numeroDocumento: '12345678' }];
        return [];
      }),
      transaction: jest.fn(async () => ({ line: { id: 'l-1', usuario: '12345678' }, yaExistia: false })),
    };
    svc.intentarSincronizarCreacion = jest.fn(async () => {});
    Object.assign(svc, over);
    return svc;
  };

  it('rechazado_definitivo: contrato no encontrado', async () => {
    const svc = hacer({ dataSource: { query: jest.fn(async () => []), transaction: jest.fn() } });
    const r = await svc.crearLineParaContrato('c-x', 'e-1');
    expect(r.clase).toBe('rechazado_definitivo');
  });

  it('no_aplica: el plan del contrato no incluye IPTV', async () => {
    const svc = hacer({
      dataSource: {
        query: jest.fn(async (sql: string) => {
          if (/FROM servicios/.test(sql)) return [{ id: 'c-1', clienteId: 'cl-1', planId: 'p-1' }];
          if (/FROM planes/.test(sql)) return [{ id: 'p-1', cuentaIptv: false }];
          return [];
        }),
        transaction: jest.fn(),
      },
    });
    const r = await svc.crearLineParaContrato('c-1', 'e-1');
    expect(r.clase).toBe('no_aplica');
  });

  it('no_aplica: el cliente no tiene número de documento', async () => {
    const svc = hacer({
      dataSource: {
        query: jest.fn(async (sql: string) => {
          if (/FROM servicios/.test(sql)) return [{ id: 'c-1', clienteId: 'cl-1', planId: 'p-1' }];
          if (/FROM planes/.test(sql)) return [{ id: 'p-1', cuentaIptv: true }];
          if (/FROM clientes/.test(sql)) return [{ numeroDocumento: null }];
          return [];
        }),
        transaction: jest.fn(),
      },
    });
    const r = await svc.crearLineParaContrato('c-1', 'e-1');
    expect(r.clase).toBe('no_aplica');
  });

  it('ya_en_destino: el contrato ya tiene un line IPTV activo (idempotencia)', async () => {
    const svc = hacer({
      dataSource: {
        query: jest.fn(async (sql: string) => {
          if (/FROM servicios/.test(sql)) return [{ id: 'c-1', clienteId: 'cl-1', planId: 'p-1' }];
          if (/FROM planes/.test(sql)) return [{ id: 'p-1', cuentaIptv: true, sesionesIptv: 1, xuiBouquetIds: [] }];
          if (/FROM clientes/.test(sql)) return [{ numeroDocumento: '12345678' }];
          return [];
        }),
        transaction: jest.fn(async () => ({ line: { id: 'l-1', usuario: '12345678' }, yaExistia: true })),
      },
    });
    const r = await svc.crearLineParaContrato('c-1', 'e-1');
    expect(r.clase).toBe('ya_en_destino');
    expect(svc.intentarSincronizarCreacion).not.toHaveBeenCalled();
  });

  it('aplicado: line creado localmente (sincronización con XUI best-effort en curso)', async () => {
    const svc = hacer();
    const r = await svc.crearLineParaContrato('c-1', 'e-1');
    expect(r.clase).toBe('aplicado');
  });

  it('el error inesperado no lanza: cae en clasificarError vía el catch', async () => {
    const svc = hacer({ dataSource: { query: jest.fn(async () => { throw new Error('BD caída'); }), transaction: jest.fn() } });
    await expect(svc.crearLineParaContrato('c-1', 'e-1')).resolves.toHaveProperty('clase');
  });
});

describe('XuiLinesService.eliminarLineDeContrato() — clasificación por rama', () => {
  const hacer = (over: Record<string, unknown> = {}) => {
    const svc = Object.create(XuiLinesService.prototype) as any;
    svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    svc.repo = { findOne: jest.fn(async () => ({ id: 'l-1' })), update: jest.fn() };
    svc.intentarSincronizarEliminacion = jest.fn(async () => {});
    Object.assign(svc, over);
    return svc;
  };

  it('no_aplica: el contrato no tiene line IPTV activo', async () => {
    const svc = hacer({ repo: { findOne: jest.fn(async () => null), update: jest.fn() } });
    const r = await svc.eliminarLineDeContrato('c-1', 'e-1');
    expect(r.clase).toBe('no_aplica');
  });

  it('aplicado: line marcado para eliminación', async () => {
    const svc = hacer();
    const r = await svc.eliminarLineDeContrato('c-1', 'e-1');
    expect(r.clase).toBe('aplicado');
  });

  it('el error inesperado no lanza: cae en clasificarError vía el catch', async () => {
    const svc = hacer({ repo: { findOne: jest.fn(async () => { throw new Error('BD caída'); }), update: jest.fn() } });
    await expect(svc.eliminarLineDeContrato('c-1', 'e-1')).resolves.toHaveProperty('clase');
  });
});

describe('XuiLinesService.habilitarLineDeContrato() / .deshabilitarLineDeContrato() — clasificación por rama', () => {
  const hacer = (over: Record<string, unknown> = {}) => {
    const svc = Object.create(XuiLinesService.prototype) as any;
    svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    svc.repo = { findOne: jest.fn(async () => ({ id: 'l-1', habilitado: false, xuiLineId: 'xui-1' })), update: jest.fn() };
    svc.xuiApi = { enableLine: jest.fn(async () => {}), disableLine: jest.fn(async () => {}) };
    Object.assign(svc, over);
    return svc;
  };

  it('habilitar: no_aplica sin line activo', async () => {
    const svc = hacer({ repo: { findOne: jest.fn(async () => null), update: jest.fn() } });
    const r = await svc.habilitarLineDeContrato('c-1', 'e-1');
    expect(r.clase).toBe('no_aplica');
  });

  it('habilitar: ya_en_destino si ya estaba habilitado', async () => {
    const svc = hacer({ repo: { findOne: jest.fn(async () => ({ id: 'l-1', habilitado: true })), update: jest.fn() } });
    const r = await svc.habilitarLineDeContrato('c-1', 'e-1');
    expect(r.clase).toBe('ya_en_destino');
  });

  it('habilitar: aplicado cuando XUI acepta el enableLine', async () => {
    const svc = hacer();
    const r = await svc.habilitarLineDeContrato('c-1', 'e-1');
    expect(r.clase).toBe('aplicado');
  });

  // Fix del grupo 3b: antes un fallo de enableLine() propagaba sin capturar hasta el
  // llamador (ContratosService.cambiarEstado(), atrapado ahí por un `.catch` genérico). El
  // catch se mueve aquí dentro para clasificar — el flag local sigue sin tocarse en el
  // camino de fallo, igual que antes (el barrido de xui-monitor.service.ts lo reintenta).
  it('habilitar: el fallo de XUI se clasifica en vez de propagar sin capturar', async () => {
    const svc = hacer({ xuiApi: { enableLine: jest.fn(async () => { throw new (require('@nestjs/common').ServiceUnavailableException)('XUI caído'); }) } });
    const r = await svc.habilitarLineDeContrato('c-1', 'e-1');
    expect(r.clase).toBe('reintentable');
    expect(svc.repo.update).not.toHaveBeenCalled();
  });

  it('deshabilitar: no_aplica sin line activo', async () => {
    const svc = hacer({ repo: { findOne: jest.fn(async () => null), update: jest.fn() } });
    const r = await svc.deshabilitarLineDeContrato('c-1', 'e-1');
    expect(r.clase).toBe('no_aplica');
  });

  it('deshabilitar: ya_en_destino si ya estaba deshabilitado', async () => {
    const svc = hacer({ repo: { findOne: jest.fn(async () => ({ id: 'l-1', habilitado: false })), update: jest.fn() } });
    const r = await svc.deshabilitarLineDeContrato('c-1', 'e-1');
    expect(r.clase).toBe('ya_en_destino');
  });

  it('deshabilitar: aplicado cuando XUI acepta el disableLine', async () => {
    const svc = hacer({ repo: { findOne: jest.fn(async () => ({ id: 'l-1', habilitado: true, xuiLineId: 'xui-1' })), update: jest.fn() } });
    const r = await svc.deshabilitarLineDeContrato('c-1', 'e-1');
    expect(r.clase).toBe('aplicado');
  });
});
