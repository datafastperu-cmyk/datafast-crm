import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';

import { VpnClienteController } from './vpn-cliente.controller';
import { VpnClienteService } from './services/vpn-cliente.service';

/**
 * Contrato de `verify-auth` con `vpn-auth.sh` (incidente 2026-07-31).
 *
 * El log de errores del backend estaba saturado por este endpoint: cientos de entradas
 * de nivel `error` con stack trace por contraseñas incorrectas, y ninguna decía qué
 * usuario fallaba. Un MikroTik al que se le revocó el cert reintenta cada ~15 s para
 * siempre, así que el ruido era permanente y tapaba los fallos reales.
 *
 * Estos tests fijan las dos mitades del arreglo. Si alguien "restaura" el
 * `UnauthorizedException` por parecer más idiomático, el bucle de ruido vuelve y el
 * script sigue funcionando igual — es decir, nadie lo notaría hasta el próximo incidente.
 */
describe('VpnClienteController.verifyAuth (contrato con vpn-auth.sh)', () => {
  let controller: VpnClienteController;
  let verifyAuth: jest.Mock;
  const reqLocal = { socket: { remoteAddress: '127.0.0.1' } } as any;

  beforeEach(async () => {
    verifyAuth = jest.fn();
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [VpnClienteController],
      providers: [{ provide: VpnClienteService, useValue: { verifyAuth } }],
    }).compile();

    controller = mod.get(VpnClienteController);
  });

  it('credenciales válidas → success:true (el script hace exit 0)', async () => {
    verifyAuth.mockResolvedValue(true);
    const r: any = await controller.verifyAuth({ username: 'df-x', password: 'ok' }, reqLocal);
    expect(r.success).toBe(true);
  });

  it('credenciales inválidas → NO lanza, devuelve success:false', async () => {
    // El script hace `curl -sf` y luego `grep -q '"success":true'`. Con 200 +
    // success:false, curl tiene exito, el grep falla y el script devuelve exit 1:
    // deniega exactamente igual que con un 401, pero sin generar un log de error.
    verifyAuth.mockResolvedValue(false);

    const r: any = await controller.verifyAuth({ username: 'df-zombi', password: 'mala' }, reqLocal);

    expect(r.success).toBe(false);
    expect(r.message).toContain('Credenciales inválidas');
  });

  it('un rechazo NUNCA se expresa como excepción: el consumidor es un script, no un humano', async () => {
    verifyAuth.mockResolvedValue(false);
    await expect(
      controller.verifyAuth({ username: 'df-zombi', password: 'mala' }, reqLocal),
    ).resolves.toBeDefined();
  });

  it('el rechazo se registra NOMBRANDO al usuario: sin identidad el log no es accionable', async () => {
    verifyAuth.mockResolvedValue(false);
    const warn = jest.spyOn((controller as any).logger, 'warn').mockImplementation(() => {});

    await controller.verifyAuth({ username: 'df-router-balanceador-fbdc06', password: 'x' }, reqLocal);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('df-router-balanceador-fbdc06');
  });

  it('un router zombi reintentando cada 15s NO inunda el log: throttle por ventana', async () => {
    // Sin throttle son ~5 700 lineas por dia por cada router con cert revocado.
    verifyAuth.mockResolvedValue(false);
    const warn = jest.spyOn((controller as any).logger, 'warn').mockImplementation(() => {});

    for (let i = 0; i < 40; i++) {
      await controller.verifyAuth({ username: 'df-zombi', password: 'mala' }, reqLocal);
    }

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('dos usuarios distintos se registran por separado: el throttle no oculta a un segundo culpable', async () => {
    verifyAuth.mockResolvedValue(false);
    const warn = jest.spyOn((controller as any).logger, 'warn').mockImplementation(() => {});

    await controller.verifyAuth({ username: 'df-zombi-a', password: 'x' }, reqLocal);
    await controller.verifyAuth({ username: 'df-zombi-b', password: 'x' }, reqLocal);

    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('tras autenticar bien, un rechazo posterior vuelve a registrarse (la racha termina)', async () => {
    const warn = jest.spyOn((controller as any).logger, 'warn').mockImplementation(() => {});

    verifyAuth.mockResolvedValue(false);
    await controller.verifyAuth({ username: 'df-intermitente', password: 'x' }, reqLocal);
    verifyAuth.mockResolvedValue(true);
    await controller.verifyAuth({ username: 'df-intermitente', password: 'ok' }, reqLocal);
    verifyAuth.mockResolvedValue(false);
    await controller.verifyAuth({ username: 'df-intermitente', password: 'x' }, reqLocal);

    // Un equipo que alterna entre autenticar y fallar es un problema distinto —y peor—
    // que uno que nunca autentica. El throttle no debe esconderlo.
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('sigue siendo inaccesible fuera de localhost', async () => {
    const reqRemoto = { socket: { remoteAddress: '181.67.53.27' } } as any;
    await expect(
      controller.verifyAuth({ username: 'x', password: 'y' }, reqRemoto),
    ).rejects.toThrow(ForbiddenException);
    expect(verifyAuth).not.toHaveBeenCalled();
  });
});
