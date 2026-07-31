// whatsapp-web.js arrastra puppeteer entero al importarse; el test no necesita
// un navegador para ejercitar el corte.
jest.mock('whatsapp-web.js', () => ({ Client: class {}, LocalAuth: class {}, MessageMedia: {} }));
jest.mock('qrcode', () => ({ toDataURL: jest.fn() }));

import { WaClientService } from './wa-client.service';

// Incidente 22/07–30/07 2026: el cliente de WhatsApp emitió 35.369 QR sin que
// nadie los escaneara, durante 8 días seguidos, con Chromium residente en un VPS
// de 1.9 GB. Ni 'disconnected' ni 'auth_failure' se disparan en ese modo de fallo,
// así que el circuit breaker de reinicios (MAX_RESTARTS) nunca intervino y el
// módulo siguió reportando 'ok' al ModuleHealth todo el tiempo.
describe('WaClientService — corte por QR no escaneado (incidente 22-30/07)', () => {
  const construir = () => {
    const destroy = jest.fn().mockResolvedValue(undefined);
    const gateway = { emitStatus: jest.fn(), emitMensaje: jest.fn(), emitChats: jest.fn(), emitChatUpdate: jest.fn() };
    const health  = { registrar: jest.fn() };
    const eventos = { registrar: jest.fn() };

    const svc = new WaClientService(
      {} as any,           // CrmNativoService
      gateway as any,
      { snapshot: jest.fn(), setEstado: jest.fn() } as any,
      health as any,
      eventos as any,
    );
    (svc as any).client = { destroy };

    return { svc, destroy, gateway, health, eventos };
  };

  it('libera Chromium y deja el módulo DEGRADADO en vez de seguir emitiendo QR', async () => {
    const { svc, destroy, gateway, health, eventos } = construir();

    await (svc as any).detenerPorQrNoEscaneado();

    expect(destroy).toHaveBeenCalledTimes(1);
    expect((svc as any).client).toBeNull();
    expect(health.registrar).toHaveBeenCalledWith(
      'crm-whatsapp', 'degraded', expect.stringContaining('sin escaneo'),
    );
    expect(gateway.emitStatus).toHaveBeenCalledWith({ estado: 'DESCONECTADO' });
    expect(eventos.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ codigo: 'WA_QR_NO_ESCANEADO', origen: 'whatsapp' }),
    );
  });

  it('no se relanza solo tras el corte — reintentar solo devuelve al bucle de QR', async () => {
    const { svc } = construir();
    const iniciar = jest.spyOn(svc as any, 'iniciarCliente').mockResolvedValue(undefined);

    await (svc as any).detenerPorQrNoEscaneado();
    await (svc as any).reiniciarConRetraso(0);

    expect(iniciar).not.toHaveBeenCalled();
  });

  it('es idempotente: un segundo corte no vuelve a destruir ni a re-alertar', async () => {
    const { svc, destroy, eventos } = construir();

    await (svc as any).detenerPorQrNoEscaneado();
    await (svc as any).detenerPorQrNoEscaneado();

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(eventos.registrar).toHaveBeenCalledTimes(1);
  });
});
