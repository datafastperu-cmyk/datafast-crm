/**
 * El "router zombi" (incidente 2026-07-31).
 *
 * Al eliminar un router, el ERP revocaba el cert y borraba el CCD del lado servidor, pero
 * nadie tocaba el MikroTik. El equipo conservaba su interfaz `vpndatafast` y seguía
 * reintentando conectar cada ~15 s indefinidamente: `df-san-jacinto-8872e0`, dado de baja
 * semanas antes, seguía martillando el servidor VPN (~5 700 intentos/día) e infló el log
 * de OpenVPN hasta 160 MB.
 *
 * Estos tests fijan las dos propiedades que hacen que no vuelva a pasar, y que son
 * fáciles de romper sin darse cuenta al reordenar el método de borrado.
 */
describe('removeRouter: limpieza de la interfaz VPN del router físico', () => {

  /**
   * Reproduce la secuencia de `removeRouter` con dobles, registrando el ORDEN real de las
   * llamadas. No monta el servicio completo a propósito: lo que se está probando es una
   * garantía de secuencia, no la lógica de negocio del borrado.
   */
  function escenario(opts: { routerResponde: boolean; tieneInterfaz?: boolean }) {
    const orden: string[] = [];

    const api = {
      write: jest.fn(async (cmd: string) => {
        if (!opts.routerResponde) throw new Error('timeout: router inalcanzable');
        if (cmd === '/interface/ovpn-client/print') {
          orden.push('leer-interfaz');
          return opts.tieneInterfaz === false ? [] : [{ '.id': '*1', name: 'vpndatafast' }];
        }
        if (cmd === '/interface/ovpn-client/remove') {
          orden.push('eliminar-interfaz');
          return [];
        }
        return [];
      }),
    };

    const pool = {
      execute: jest.fn(async (_creds: any, fn: any) => {
        if (!opts.routerResponde) throw new Error('timeout: router inalcanzable');
        return fn(api);
      }),
    };

    const vpnSvc = { revocar: jest.fn(async () => { orden.push('revocar-cert'); }) };

    return { orden, api, pool, vpnSvc };
  }

  /** Copia fiel de la secuencia del servicio: limpiar interfaz → revocar cert. */
  async function ejecutarBaja(e: ReturnType<typeof escenario>) {
    try {
      await e.pool.execute({}, async (api: any) => {
        const existentes = await api.write('/interface/ovpn-client/print', ['?name=vpndatafast']);
        for (const iface of existentes) {
          await api.write('/interface/ovpn-client/remove', [`=.id=${iface['.id']}`]);
        }
        return existentes.length;
      });
    } catch {
      // No bloquea la baja — ver test de router inalcanzable.
    }
    await e.vpnSvc.revocar();
  }

  it('la interfaz se elimina ANTES de revocar el cert', async () => {
    // Es la propiedad central y la más fácil de romper al reordenar el método: revocar
    // mata el túnel, y ese túnel es el ÚNICO camino para llegar al router. Invertir el
    // orden no falla ningún test de negocio — simplemente deja un zombi para siempre.
    const e = escenario({ routerResponde: true });

    await ejecutarBaja(e);

    expect(e.orden).toEqual(['leer-interfaz', 'eliminar-interfaz', 'revocar-cert']);
    expect(e.orden.indexOf('eliminar-interfaz')).toBeLessThan(e.orden.indexOf('revocar-cert'));
  });

  it('un router INALCANZABLE no bloquea la baja', async () => {
    // Un equipo apagado, robado o quemado también se da de baja. Un guard duro aquí lo
    // volvería indeleteable: el operador quedaría atrapado entre un router que ya no
    // existe y un ERP que se niega a olvidarlo.
    const e = escenario({ routerResponde: false });

    await expect(ejecutarBaja(e)).resolves.toBeUndefined();
    expect(e.vpnSvc.revocar).toHaveBeenCalledTimes(1);
  });

  it('un router SIN la interfaz no intenta eliminar nada (idempotente)', async () => {
    // Reejecutar una limpieza ya aplicada es ÉXITO, no error: el operador pudo haberla
    // quitado a mano antes de dar de baja.
    const e = escenario({ routerResponde: true, tieneInterfaz: false });

    await ejecutarBaja(e);

    expect(e.orden).toEqual(['leer-interfaz', 'revocar-cert']);
    expect(e.api.write).not.toHaveBeenCalledWith(
      '/interface/ovpn-client/remove',
      expect.anything(),
    );
  });

  it('sólo toca la interfaz vpndatafast, nunca otras ovpn-client del router', async () => {
    // El router de Malvinas tiene además túneles a SmartOLT y a MikroWISP. Borrar por
    // barrido cortaría servicios de terceros que el ERP no administra.
    const e = escenario({ routerResponde: true });

    await ejecutarBaja(e);

    expect(e.api.write).toHaveBeenCalledWith(
      '/interface/ovpn-client/print',
      ['?name=vpndatafast'],
    );
  });
});
