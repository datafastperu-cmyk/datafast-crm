import { FtthOnuEstado, FtthCarrilEstado } from '../entities/ftth-onu-registro.entity';
import { ProvisionFtthService } from './provision-ftth.service';

// Ola 1 (2026-08-16) — conversión de `actualizarWan()` y `reaplicar()` a `ResultadoOperacion`.
// Ambos son consumidos por el outbox (OutboxRedService.ejecutarComandoOnu, acciones
// ACTUALIZAR_WAN_ONU y REAPROVISIONAR_ONU): el primer grupo de la Ola 1 (F-0.1 §9.1), porque
// una operación que solo llama un controller humano gana poco de hablar dominio y una que
// consume el outbox lo gana todo (E03-02).
//
// Origen (D-14, E-0.3 §10): un no-op leído como fallo → 1788 reintentos contra el MA5800 en
// 4 días; un 409 de lock leído como veredicto → trabajo descartado. Estos tests fijan que la
// clasificación de cada rama es la correcta, no solo que el método no lanza.
describe('ProvisionFtthService.actualizarWan() — clasificación por rama', () => {
  const hacer = (over: Record<string, unknown> = {}) => {
    const svc = Object.create(ProvisionFtthService.prototype) as any;
    svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    svc.ftthRepo = { findOne: jest.fn(), update: jest.fn() };
    svc.automation = { ftthInjectWanPppoe: jest.fn() };
    svc._fetchContrato   = jest.fn(async () => ({ vlan_id: 50, tipo_auth: 'pppoe' }));
    svc._buildWanInject  = jest.fn(() => ({ payload: { mode: 'pppoe' } }));
    svc._fetchOlt         = jest.fn(async () => ({ id: 'olt-1' }));
    svc._decryptOltPassword = jest.fn(() => 'pw');
    svc._buildConn        = jest.fn(() => ({ ip: '10.0.0.1' }));
    svc._limpiar          = (x: unknown) => x;
    Object.assign(svc, over);
    return svc;
  };

  it('no_aplica: sin registro FTTH — nada que actualizar', async () => {
    const svc = hacer({ ftthRepo: { findOne: jest.fn(async () => null), update: jest.fn() } });
    const r = await svc.actualizarWan('c-1', 'e-1');
    expect(r.clase).toBe('no_aplica');
  });

  it('no_aplica: ONU en modo bridge — la WAN la maneja el router del cliente', async () => {
    const svc = hacer({
      ftthRepo: { findOne: jest.fn(async () => ({ wanMode: 'bridge' })), update: jest.fn() },
    });
    const r = await svc.actualizarWan('c-1', 'e-1');
    expect(r.clase).toBe('no_aplica');
  });

  // Cambia respecto de la traducción ad-hoc que tenía el outbox (`skipped → no_aplica`, ver
  // el comentario de `actualizarWan` en producción): SÍ hay algo que hacer
  // (Re-Aprovisionar), y reintentar ESTA operación produce el mismo rechazo siempre.
  it('rechazado_definitivo: la VLAN del servicio cambió — Re-Aprovisionar, no reintentar esto', async () => {
    const svc = hacer({
      ftthRepo: {
        findOne: jest.fn(async () => ({ wanMode: 'routing', estado: FtthOnuEstado.ACTIVO, vlan: 50 })),
        update:  jest.fn(),
      },
      _fetchContrato: jest.fn(async () => ({ vlan_id: 999 })),
    });
    const r = await svc.actualizarWan('c-1', 'e-1');
    expect(r.clase).toBe('rechazado_definitivo');
    expect(r.motivo).toMatch(/Re-Aprovisionar/);
  });

  // Cambia respecto del default `reintentable` que tenía el outbox: unas credenciales que
  // faltan no aparecen solas con un reintento — es un dato de configuración.
  it('rechazado_definitivo: faltan credenciales PPPoE — dato de configuración, no falla transitoria', async () => {
    const svc = hacer({
      ftthRepo: {
        findOne: jest.fn(async () => ({ wanMode: 'routing', estado: FtthOnuEstado.ACTIVO, vlan: 50 })),
        update:  jest.fn(),
      },
      _buildWanInject: jest.fn(() => ({ error: 'El contrato PPPoE no tiene credenciales.' })),
    });
    const r = await svc.actualizarWan('c-1', 'e-1');
    expect(r.clase).toBe('rechazado_definitivo');
    expect(r.motivo).toMatch(/credenciales/);
  });

  it('reintentable: el automatismo respondió y rechazó — no fue un timeout de transporte', async () => {
    const svc = hacer({
      ftthRepo: {
        findOne: jest.fn(async () => ({ wanMode: 'routing', estado: FtthOnuEstado.ACTIVO, vlan: 50 })),
        update:  jest.fn(),
      },
      automation: { ftthInjectWanPppoe: jest.fn(async () => ({ success: false, error: 'CLI rechazó el comando' })) },
    });
    const r = await svc.actualizarWan('c-1', 'e-1');
    expect(r.clase).toBe('reintentable');
  });

  it('aplicado: la WAN se inyectó y el automatismo lo confirmó', async () => {
    const svc = hacer({
      ftthRepo: {
        findOne: jest.fn(async () => ({ id: 'r-1', wanMode: 'routing', estado: FtthOnuEstado.ACTIVO, vlan: 50 })),
        update:  jest.fn(),
      },
      automation: { ftthInjectWanPppoe: jest.fn(async () => ({ success: true })) },
    });
    const r = await svc.actualizarWan('c-1', 'e-1');
    expect(r.clase).toBe('aplicado');
  });

  // El caso malo (PC-04): un error inesperado no debe tumbar el outbox — `clasificarError`
  // decide, no una excepción sin capturar.
  it('el error inesperado no lanza: cae en clasificarError vía el catch', async () => {
    const svc = hacer({
      ftthRepo: { findOne: jest.fn(async () => { throw new Error('BD caída'); }), update: jest.fn() },
    });
    await expect(svc.actualizarWan('c-1', 'e-1')).resolves.toHaveProperty('clase');
  });
});

describe('ProvisionFtthService.reaplicar() — clasificación por rama', () => {
  const hacer = (over: Record<string, unknown> = {}) => {
    const svc = Object.create(ProvisionFtthService.prototype) as any;
    svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    svc.ftthRepo = { findOne: jest.fn() };
    svc.provisionarFtth = jest.fn(async () => ({ estado: FtthOnuEstado.ACTIVO, registroId: 'r-1', mensaje: 'ok' }));
    Object.assign(svc, over);
    return svc;
  };

  it('rechazado_definitivo: no hay registro FTTH — no hay nada que re-aplicar', async () => {
    const svc = hacer({ ftthRepo: { findOne: jest.fn(async () => null) } });
    const r = await svc.reaplicar('c-1', 'e-1');
    expect(r.clase).toBe('rechazado_definitivo');
  });

  it('rechazado_definitivo: sin perfiles GPON guardados — reaprovisionar, no reintentar esto', async () => {
    const svc = hacer({
      ftthRepo: { findOne: jest.fn(async () => ({ lineprofileId: null, srvprofileId: null })) },
    });
    const r = await svc.reaplicar('c-1', 'e-1');
    expect(r.clase).toBe('rechazado_definitivo');
    expect(r.motivo).toMatch(/re-aprovisiona/);
  });

  it('aplicado: provisionarFtth confirma estado ACTIVO', async () => {
    const svc = hacer({
      ftthRepo: { findOne: jest.fn(async () => ({ lineprofileId: 1, srvprofileId: 1, frame: 0, slot: 0, port: 0, sn: 'SN1', vlan: 10 })) },
    });
    const r = await svc.reaplicar('c-1', 'e-1');
    expect(r.clase).toBe('aplicado');
  });

  // Precisión sobre el criterio que tenía el outbox (`estado === 'activo' ? aplicado :
  // reintentable`, ver el comentario en outbox-red.service.ts): el nombre del propio estado
  // dice que no se sabe si se aplicó (VIO, E-0.3 D-18) — reintentar a ciegas ensucia el
  // plano físico.
  it('indeterminado: TIMEOUT_ONLINE — no se sabe si se aplicó, no es un reintentable más', async () => {
    const svc = hacer({
      ftthRepo: { findOne: jest.fn(async () => ({ lineprofileId: 1, srvprofileId: 1, frame: 0, slot: 0, port: 0, sn: 'SN1', vlan: 10 })) },
      provisionarFtth: jest.fn(async () => ({ estado: FtthOnuEstado.TIMEOUT_ONLINE, registroId: 'r-1', mensaje: 'sin respuesta' })),
    });
    const r = await svc.reaplicar('c-1', 'e-1');
    expect(r.clase).toBe('indeterminado');
  });

  it('reintentable: cualquier otro estado no-ACTIVO — provisionarFtth es idempotente', async () => {
    const svc = hacer({
      ftthRepo: { findOne: jest.fn(async () => ({ lineprofileId: 1, srvprofileId: 1, frame: 0, slot: 0, port: 0, sn: 'SN1', vlan: 10 })) },
      provisionarFtth: jest.fn(async () => ({ estado: FtthOnuEstado.FALLIDO_WAN, registroId: 'r-1', mensaje: 'fase WAN falló' })),
    });
    const r = await svc.reaplicar('c-1', 'e-1');
    expect(r.clase).toBe('reintentable');
  });

  it('el error inesperado no lanza: cae en clasificarError vía el catch', async () => {
    const svc = hacer({ ftthRepo: { findOne: jest.fn(async () => { throw new Error('BD caída'); }) } });
    await expect(svc.reaplicar('c-1', 'e-1')).resolves.toHaveProperty('clase');
  });
});

// Ola 1, grupo 4 (2026-08-17, cierre de la ola) — activarCarril() habla ResultadoOperacion
// con el payload `estado` (ResultadoActivarCarril, extensión LOCAL transitoria — ver
// metodos-frontera.ts). Sus dos llamadores reales: panel operador (olt-nativo.controller.ts)
// y portal del abonado (PortalOnuService.conectar(), primer borde de esta ola que da a un
// cliente final, no a un operador ni al outbox).
describe('ProvisionFtthService.activarCarril() — clasificación por rama', () => {
  const hacer = (over: Record<string, unknown> = {}) => {
    const svc = Object.create(ProvisionFtthService.prototype) as any;
    svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    svc.ftthRepo = { findOne: jest.fn(), update: jest.fn() };
    svc.genieDriver = { getLastInformBySerial: jest.fn(async () => null) };
    svc.events = { emit: jest.fn() };
    Object.assign(svc, over);
    return svc;
  };

  it('rechazado_definitivo: sin registro FTTH — no hay carril que activar', async () => {
    const svc = hacer({ ftthRepo: { findOne: jest.fn(async () => null), update: jest.fn() } });
    const r = await svc.activarCarril('c-1', 'e-1');
    expect(r.clase).toBe('rechazado_definitivo');
  });

  it('rechazado_definitivo: registro en un estado que no admite activar el carril', async () => {
    const svc = hacer({
      ftthRepo: { findOne: jest.fn(async () => ({ estado: FtthOnuEstado.PENDIENTE })), update: jest.fn() },
    });
    const r = await svc.activarCarril('c-1', 'e-1');
    expect(r.clase).toBe('rechazado_definitivo');
    expect(r.motivo).toMatch(/activo.*gpon_registrado/i);
  });

  it('aplicado: ya se está activando — no-op con el payload `estado`', async () => {
    const svc = hacer({
      ftthRepo: {
        findOne: jest.fn(async () => ({
          id: 'r-1', estado: FtthOnuEstado.ACTIVO, carrilEstado: FtthCarrilEstado.ACTIVANDO,
        })),
        update: jest.fn(),
      },
    });
    const r = await svc.activarCarril('c-1', 'e-1');
    expect(r.clase).toBe('aplicado');
    expect(r.estado).toBe(FtthCarrilEstado.ACTIVANDO);
  });

  it('ya_en_destino: carril activo y sesión TR-069 viva — verificado, no solo leído de BD', async () => {
    const svc = hacer({
      ftthRepo: {
        findOne: jest.fn(async () => ({
          id: 'r-1', sn: 'SN1', estado: FtthOnuEstado.ACTIVO, carrilEstado: FtthCarrilEstado.ACTIVO,
        })),
        update: jest.fn(),
      },
      genieDriver: { getLastInformBySerial: jest.fn(async () => new Date()) },
    });
    const r = await svc.activarCarril('c-1', 'e-1');
    expect(r.clase).toBe('ya_en_destino');
    expect(r.estado).toBe(FtthCarrilEstado.ACTIVO);
  });

  it('aplicado: carril activo pero sesión rancia — revive (re-bootstrap), no ya_en_destino', async () => {
    const svc = hacer({
      ftthRepo: {
        findOne: jest.fn(async () => ({
          id: 'r-1', sn: 'SN1', estado: FtthOnuEstado.ACTIVO, carrilEstado: FtthCarrilEstado.ACTIVO,
        })),
        update: jest.fn(),
      },
      genieDriver: { getLastInformBySerial: jest.fn(async () => null) }, // nunca informó → no vivo
    });
    const r = await svc.activarCarril('c-1', 'e-1');
    expect(r.clase).toBe('aplicado');
    expect(r.estado).toBe(FtthCarrilEstado.ACTIVANDO);
  });

  it('aplicado: carril inactivo — arranca la activación (write-ahead + evento)', async () => {
    const update = jest.fn();
    const emit = jest.fn();
    const svc = hacer({
      ftthRepo: {
        findOne: jest.fn(async () => ({
          id: 'r-1', estado: FtthOnuEstado.GPON_REGISTRADO, carrilEstado: FtthCarrilEstado.INACTIVO,
        })),
        update,
      },
      events: { emit },
    });
    const r = await svc.activarCarril('c-1', 'e-1');
    expect(r.clase).toBe('aplicado');
    expect(r.estado).toBe(FtthCarrilEstado.ACTIVANDO);
    // Write-ahead: el estado se persiste ANTES de emitir el evento que dispara el bootstrap.
    expect(update).toHaveBeenCalledWith('r-1', expect.objectContaining({ carrilEstado: FtthCarrilEstado.ACTIVANDO }));
    expect(emit).toHaveBeenCalledWith('ftth.carril.activar', { contratoId: 'c-1', empresaId: 'e-1' });
  });

  it('el error inesperado no lanza: cae en clasificarError vía el catch', async () => {
    const svc = hacer({ ftthRepo: { findOne: jest.fn(async () => { throw new Error('BD caída'); }) } });
    await expect(svc.activarCarril('c-1', 'e-1')).resolves.toHaveProperty('clase');
  });
});
