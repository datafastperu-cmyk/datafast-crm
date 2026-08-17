import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OutboxRedService } from './outbox-red.service';
import { FirewallService } from '../mikrotik/services/firewall.service';
import { PppoeService } from '../mikrotik/services/pppoe.service';
import { QueueService } from '../mikrotik/services/queue.service';
import { ProvisionFtthService } from '../olt-nativo/services/provision-ftth.service';
import { WatcherHeartbeatService } from '../../common/services/watcher-heartbeat.service';
import { NOTIFICATION_EVENTS } from '../notificaciones/events/notification.events';

// Ola 1, grupo 3b, bloque grande (2026-08-17). La ruta mikrotik de ejecutarComando() ahora
// espeja ejecutarComandoOnu(): el resultado llega clasificado por el dominio
// (FirewallService/PppoeService/QueueService hablan ResultadoOperacion), y el dispatcher
// traduce a los 4 desenlaces sin volver a inferir nada de una excepción sin tipar.
//
// "Trampa 1" (F-0.1 §9.1): AGOTADO significaba dos cosas en este fichero. Ahora
// OUTBOX_RED_RECHAZO_PERMANENTE / OUTBOX_RED_INDETERMINADO son códigos nuevos y distintos;
// el OUTBOX_RED_AGOTADO existente (visibilidad, sigue PENDIENTE) queda intacto — se verifica
// aquí que las dos rutas no compiten entre sí.
describe('OutboxRedService — dispatcher mikrotik (ejecutarComando)', () => {
  let queries: Array<{ sql: string; params?: any[] }>;
  let filasReclamo: any[];
  let contratoRow: any;
  let firewallSvc: { suspenderCliente: jest.Mock; reactivarCliente: jest.Mock; aplicarProrroga: jest.Mock };
  let pppoeSvc: { crear: jest.Mock; eliminar: jest.Mock; setEstado: jest.Mock; desconectarSesion: jest.Mock };
  let queueSvc: { crearSimpleQueue: jest.Mock };
  let eventosRegistrar: jest.Mock;
  let eventsEmit: jest.Mock;

  const routerRow = {
    ip_gestion: '10.0.0.1', vpn_ip: null, usuario: 'admin', password_cifrado: 'x',
    usar_ssl: false, puerto_api: 8728, puerto_api_ssl: 8729, version_ros: 'v7',
    timeout_conexion: 10,
  };

  const APLICADO = { clase: 'aplicado' as const, mensaje: 'ok' };

  const crearServicio = async () => {
    queries = [];
    contratoRow = null;
    eventosRegistrar = jest.fn();
    eventsEmit = jest.fn();
    firewallSvc = {
      suspenderCliente: jest.fn().mockResolvedValue(APLICADO),
      reactivarCliente: jest.fn().mockResolvedValue(APLICADO),
      aplicarProrroga:  jest.fn().mockResolvedValue(APLICADO),
    };
    pppoeSvc = {
      crear:             jest.fn().mockResolvedValue(APLICADO),
      eliminar:          jest.fn().mockResolvedValue(APLICADO),
      setEstado:         jest.fn().mockResolvedValue(APLICADO),
      desconectarSesion: jest.fn().mockResolvedValue(APLICADO),
    };
    queueSvc = { crearSimpleQueue: jest.fn().mockResolvedValue(APLICADO) };

    const dsMock = {
      query: jest.fn(async (sql: string, params?: any[]) => {
        queries.push({ sql, params });
        if (/RETURNING id, servicio_id, router_id, accion, payload, intentos, max_intentos/.test(sql)) {
          return [filasReclamo, filasReclamo.length];
        }
        if (/FROM\s+routers\s+WHERE\s+id/i.test(sql)) {
          return [routerRow];
        }
        if (/FROM\s+servicios\s+co/i.test(sql)) {
          return contratoRow ? [contratoRow] : [];
        }
        if (/^\s*(UPDATE|DELETE|INSERT)/i.test(sql)) {
          return [[], 0];
        }
        return [];
      }),
    };

    const mod = await Test.createTestingModule({
      providers: [
        OutboxRedService,
        { provide: getDataSourceToken(), useValue: dsMock },
        { provide: FirewallService,      useValue: firewallSvc },
        { provide: PppoeService,         useValue: pppoeSvc },
        { provide: QueueService,         useValue: queueSvc },
        { provide: ProvisionFtthService, useValue: {} },
        { provide: EventEmitter2,        useValue: { emit: eventsEmit } },
        { provide: WatcherHeartbeatService, useValue: {
          ejecutar: jest.fn(async (_n: string, _i: number, fn: any) => fn()),
        } },
      ],
    }).compile();

    const svc: OutboxRedService = mod.get(OutboxRedService);
    // EventosSistemaService es @Optional() y no se provee arriba (mismo patrón que
    // outbox-red.claim.spec.ts); se inyecta manualmente para poder espiar registrar().
    (svc as any).eventos = { registrar: eventosRegistrar };
    return svc;
  };

  const finalUpdate = () =>
    queries.filter((q) => /UPDATE\s+comandos_red_pendientes/i.test(q.sql) && !/RETURNING/i.test(q.sql)).pop();

  it('SUSPENDER: éxito → EJECUTADO', async () => {
    const svc = await crearServicio();
    filasReclamo = [{ id: 1, servicio_id: 'c-1', router_id: 'r-1', accion: 'SUSPENDER',
      payload: { ipAsignada: '10.0.0.5', clienteId: 'c-1' }, intentos: 0, max_intentos: 12 }];

    await svc.procesarPendientes();

    expect(firewallSvc.suspenderCliente).toHaveBeenCalled();
    expect(finalUpdate()!.sql).toMatch(/estado\s*=\s*'EJECUTADO'/);
  });

  it('REACTIVAR: éxito → EJECUTADO', async () => {
    const svc = await crearServicio();
    filasReclamo = [{ id: 2, servicio_id: 'c-1', router_id: 'r-1', accion: 'REACTIVAR',
      payload: { ipAsignada: '10.0.0.5', usuarioPppoe: 'u1' }, intentos: 0, max_intentos: 12 }];

    await svc.procesarPendientes();

    expect(firewallSvc.reactivarCliente).toHaveBeenCalled();
    expect(pppoeSvc.setEstado).toHaveBeenCalledWith(expect.anything(), 'u1', false);
    expect(finalUpdate()!.sql).toMatch(/estado\s*=\s*'EJECUTADO'/);
  });

  it('PROVISIONAR: PPPoE + Simple Queue → EJECUTADO', async () => {
    const svc = await crearServicio();
    filasReclamo = [{ id: 3, servicio_id: 'c-1', router_id: 'r-1', accion: 'PROVISIONAR',
      payload: { usuarioPppoe: 'u1', passwordPppoe: 'p', ipAsignada: '10.0.0.5',
        clienteId: 'c-1', downloadMbps: 10, uploadMbps: 5 },
      intentos: 0, max_intentos: 12 }];

    await svc.procesarPendientes();

    expect(pppoeSvc.crear).toHaveBeenCalled();
    expect(queueSvc.crearSimpleQueue).toHaveBeenCalled();
    expect(finalUpdate()!.sql).toMatch(/estado\s*=\s*'EJECUTADO'/);
  });

  // DESPROVISIONAR: la limpieza de address-list es best-effort — su fallo NO aborta la
  // eliminación del PPPoE, que es lo que determina el resultado final.
  it('DESPROVISIONAR: falla la limpieza de address-list pero NO aborta — PPPoE sí se elimina y termina EJECUTADO', async () => {
    const svc = await crearServicio();
    contratoRow = { usuarioPppoe: 'u1', ipAsignada: '10.0.0.5', macAddress: null, tipoAuth: 'pppoe', tipoControl: null };
    firewallSvc.reactivarCliente.mockResolvedValue({ clase: 'indeterminado', motivo: 'Timeout de comando en 10.0.0.1 (20s)' });
    filasReclamo = [{ id: 4, servicio_id: 'c-1', router_id: 'r-1', accion: 'DESPROVISIONAR',
      payload: {}, intentos: 0, max_intentos: 12 }];

    await svc.procesarPendientes();

    expect(firewallSvc.reactivarCliente).toHaveBeenCalled();
    expect(pppoeSvc.eliminar).toHaveBeenCalledWith(expect.anything(), 'u1');
    expect(finalUpdate()!.sql).toMatch(/estado\s*=\s*'EJECUTADO'/);
  });

  // PC-04: ninguna de las 8 capacidades produce rechazado_definitivo hoy (F-0.1 §9.1) — la
  // rama existe por completitud del patrón y se ejercita aquí con un resultado fabricado.
  it('rechazado_definitivo (fabricado): AGOTADO + evento OUTBOX_RED_RECHAZO_PERMANENTE', async () => {
    const svc = await crearServicio();
    firewallSvc.suspenderCliente.mockResolvedValue({ clase: 'rechazado_definitivo', motivo: 'motivo-fabricado' });
    filasReclamo = [{ id: 5, servicio_id: 'c-1', router_id: 'r-1', accion: 'SUSPENDER',
      payload: { ipAsignada: '10.0.0.5', clienteId: 'c-1' }, intentos: 0, max_intentos: 12 }];

    await svc.procesarPendientes();

    expect(finalUpdate()!.sql).toMatch(/estado\s*=\s*'AGOTADO'/);
    expect(eventosRegistrar).toHaveBeenCalledWith(
      expect.objectContaining({ codigo: 'OUTBOX_RED_RECHAZO_PERMANENTE', origen: 'mikrotik' }),
    );
  });

  // Trampa 2 (F-0.1 §9.1): un timeout de COMANDO (enviado sin respuesta) es indeterminado —
  // pudo aplicarse. Se deja PENDIENTE con el prefijo INDETERMINADO y se audita, sin bucle
  // inmediato ni descarte.
  it('indeterminado: PENDIENTE con prefijo INDETERMINADO + evento OUTBOX_RED_INDETERMINADO', async () => {
    const svc = await crearServicio();
    firewallSvc.reactivarCliente.mockResolvedValue({ clase: 'indeterminado', motivo: 'Timeout de comando en 10.0.0.1 (20s)' });
    filasReclamo = [{ id: 6, servicio_id: 'c-1', router_id: 'r-1', accion: 'REACTIVAR',
      payload: { ipAsignada: '10.0.0.5' }, intentos: 0, max_intentos: 12 }];

    await svc.procesarPendientes();

    const upd = finalUpdate()!;
    expect(upd.sql).toMatch(/estado\s*=\s*'PENDIENTE'/);
    expect(upd.params).toEqual(expect.arrayContaining([expect.stringContaining('INDETERMINADO:')]));
    expect(eventosRegistrar).toHaveBeenCalledWith(
      expect.objectContaining({ codigo: 'OUTBOX_RED_INDETERMINADO', origen: 'mikrotik' }),
    );
  });

  // reintentable, dominante hoy (timeout de CONEXIÓN — ningún comando llegó a salir):
  // nunca se descarta, sigue PENDIENTE indefinidamente.
  it('reintentable por debajo de max_intentos: PENDIENTE, sin notificación de visibilidad', async () => {
    const svc = await crearServicio();
    firewallSvc.suspenderCliente.mockResolvedValue({ clase: 'reintentable', motivo: 'Timeout conectando a 10.0.0.1:8728' });
    filasReclamo = [{ id: 7, servicio_id: 'c-1', router_id: 'r-1', accion: 'SUSPENDER',
      payload: { ipAsignada: '10.0.0.5', clienteId: 'c-1' }, intentos: 0, max_intentos: 12 }];

    await svc.procesarPendientes();

    expect(finalUpdate()!.sql).toMatch(/estado\s*=\s*'PENDIENTE'/);
    expect(eventsEmit).not.toHaveBeenCalledWith(NOTIFICATION_EVENTS.OUTBOX_RED_AGOTADO, expect.anything());
  });

  // Trampa 1: OUTBOX_RED_AGOTADO (visibilidad, sigue reintentando) es un concepto DISTINTO
  // de rechazado_definitivo/AGOTADO-terminal — su disparo al llegar a max_intentos queda
  // intacto, sin competir con el código nuevo.
  it('reintentable al llegar a max_intentos: dispara el evento OUTBOX_RED_AGOTADO existente sin tocarlo', async () => {
    const svc = await crearServicio();
    firewallSvc.suspenderCliente.mockResolvedValue({ clase: 'reintentable', motivo: 'Timeout conectando a 10.0.0.1:8728' });
    filasReclamo = [{ id: 8, servicio_id: 'c-1', router_id: 'r-1', accion: 'SUSPENDER',
      payload: { ipAsignada: '10.0.0.5', clienteId: 'c-1' }, intentos: 2, max_intentos: 3 }];

    await svc.procesarPendientes();

    expect(finalUpdate()!.sql).toMatch(/estado\s*=\s*'PENDIENTE'/);
    expect(eventsEmit).toHaveBeenCalledWith(NOTIFICATION_EVENTS.OUTBOX_RED_AGOTADO, expect.anything());
    expect(eventosRegistrar).toHaveBeenCalledWith(
      expect.objectContaining({ codigo: 'OUTBOX_RED_AGOTADO', origen: 'mikrotik' }),
    );
  });
});
