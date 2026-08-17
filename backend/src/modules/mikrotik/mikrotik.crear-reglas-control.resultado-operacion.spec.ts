import { MikrotikService } from './mikrotik.service';

// Ola 1, grupo 3b (2026-08-16) — conversión de crearReglasControl(), técnico→técnico
// (único llamador: ContratosService.provisionarMikrotik(), D-41: solo se toca el borde).
// Antes lanzaba `Error` genérico para datos de contrato incompletos (usuario PPPoE o IP/MAC
// ausentes) — indistinguible de un fallo real de RouterOS para quien lo capturaba.
describe('MikrotikService.crearReglasControl() — clasificación por rama', () => {
  const creds = { id: 'r-1', ip: '10.0.0.1', port: 8728, user: 'admin', passwordCifrado: '', useSsl: false, timeoutSec: 15, version: 'v7' } as any;

  const hacer = (over: Record<string, unknown> = {}) => {
    const svc = Object.create(MikrotikService.prototype) as any;
    svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    svc.pppoeSvc = { crearPerfilSiNoExiste: jest.fn(async () => {}), crear: jest.fn(async () => {}) };
    svc.arpSvc = { detectarInterface: jest.fn(async () => 'ether1'), crearArpEstatico: jest.fn(async () => {}), eliminarArpEstatico: jest.fn(async () => {}) };
    svc.firewallSvc = { crearDhcpBinding: jest.fn(async () => {}) };
    Object.assign(svc, over);
    return svc;
  };

  it('rechazado_definitivo: pppoe sin usuario asignado', async () => {
    const svc = hacer();
    const r = await svc.crearReglasControl(creds, { nombreCompleto: 'Juan' }, 'pppoe');
    expect(r.clase).toBe('rechazado_definitivo');
  });

  it('aplicado: pppoe con usuario asignado', async () => {
    const svc = hacer();
    const r = await svc.crearReglasControl(creds, { nombreCompleto: 'Juan', usuarioPppoe: 'juan1' }, 'pppoe');
    expect(r.clase).toBe('aplicado');
  });

  it('rechazado_definitivo: amarre IP/MAC sin IP o MAC', async () => {
    const svc = hacer();
    const r = await svc.crearReglasControl(creds, { nombreCompleto: 'Juan' }, 'amarre_ip_mac');
    expect(r.clase).toBe('rechazado_definitivo');
  });

  it('reintentable: no se encontró interfaz para la IP', async () => {
    const svc = hacer({ arpSvc: { detectarInterface: jest.fn(async () => null), crearArpEstatico: jest.fn(), eliminarArpEstatico: jest.fn() } });
    const r = await svc.crearReglasControl(creds, { nombreCompleto: 'Juan', ipAsignada: '10.0.0.5', macAddress: 'AA:BB:CC:DD:EE:FF' }, 'amarre_ip_mac');
    expect(r.clase).toBe('reintentable');
  });

  it('aplicado: amarre IP/MAC con datos completos', async () => {
    const svc = hacer();
    const r = await svc.crearReglasControl(creds, { nombreCompleto: 'Juan', ipAsignada: '10.0.0.5', macAddress: 'AA:BB:CC:DD:EE:FF' }, 'amarre_ip_mac');
    expect(r.clase).toBe('aplicado');
  });

  // El rollback compensatorio (borrar el ARP recién creado) se preserva exactamente igual
  // que antes de convertir — solo cambia que el fallo del binding DHCP ahora se clasifica
  // en vez de propagar como excepción sin tipar.
  it('amarre_ip_mac_dhcp: si el binding DHCP falla, revierte el ARP y clasifica el fallo', async () => {
    const eliminarArpEstatico = jest.fn(async () => {});
    const svc = hacer({
      firewallSvc: { crearDhcpBinding: jest.fn(async () => { throw new Error('DHCP server caído'); }) },
      arpSvc: { detectarInterface: jest.fn(async () => 'ether1'), crearArpEstatico: jest.fn(async () => {}), eliminarArpEstatico },
    });
    const r = await svc.crearReglasControl(creds, { nombreCompleto: 'Juan', ipAsignada: '10.0.0.5', macAddress: 'AA:BB:CC:DD:EE:FF' }, 'amarre_ip_mac_dhcp');
    expect(eliminarArpEstatico).toHaveBeenCalledWith(creds, '10.0.0.5');
    expect(r).toHaveProperty('clase');
    expect(r.clase).not.toBe('aplicado');
  });

  it('no_aplica: tipo de control no reconocido no requiere reglas', async () => {
    const svc = hacer();
    const r = await svc.crearReglasControl(creds, { nombreCompleto: 'Juan' }, 'ninguna');
    expect(r.clase).toBe('no_aplica');
  });

  it('el error inesperado no lanza: cae en clasificarError vía el catch', async () => {
    const svc = hacer({ pppoeSvc: { crearPerfilSiNoExiste: jest.fn(async () => {}), crear: jest.fn(async () => { throw new Error('RouterOS no responde'); }) } });
    const r = await svc.crearReglasControl(creds, { nombreCompleto: 'Juan', usuarioPppoe: 'juan1' }, 'pppoe');
    expect(r).toHaveProperty('clase');
  });
});
