import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { SubnetRouteService } from './subnet-route.service';
import { RouterConnectionPool } from './connection-pool.service';
import { Router } from '../entities/router.entity';

/**
 * `removeVpsRoutes` afirmaba sin verificar (auditoría 2026-07-31).
 *
 * La versión anterior era `ip route del ... 2>/dev/null || true` dentro de un `catch {}`
 * vacío: la combinación hacía IMPOSIBLE que el método reportara un fallo. Afirmaba "rutas
 * eliminadas" sin comprobarlo nunca — el mismo `success: true` sin verificar que la regla
 * VIO existe para impedir, aplicado hacia adentro.
 *
 * Estos tests ejercitan las tres formas de fallar en silencio que tenía.
 */
describe('SubnetRouteService.removeVpsRoutes (VIO hacia adentro)', () => {
  let service: SubnetRouteService;

  /** Simula el estado real del kernel: qué rutas existen en cada momento. */
  let rutasEnKernel: Set<string>;
  /** Subnets cuyo `ip route del` falla (permisos, gateway distinto, etc.). */
  let borradoFalla: Set<string>;

  beforeEach(async () => {
    rutasEnKernel = new Set<string>();
    borradoFalla = new Set<string>();

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        SubnetRouteService,
        { provide: getRepositoryToken(Router), useValue: {} },
        { provide: RouterConnectionPool, useValue: {} },
      ],
    }).compile();

    service = mod.get(SubnetRouteService);

    // Se intercepta el ÚNICO punto donde el servicio toca la tabla de rutas. Así el test
    // ejercita la verificación real (`ip route show` tras el borrado), no una versión
    // simplificada: si alguien quita la comprobación, estos tests fallan.
    jest.spyOn(service as any, '_ejecutar').mockImplementation(async (cmd: unknown) => {
      const comando = cmd as string;

      const del = comando.match(/^ip route del (\S+)/);
      if (del) {
        const subnet = del[1];
        if (borradoFalla.has(subnet)) throw new Error('RTNETLINK answers: No such process');
        rutasEnKernel.delete(subnet);
        return { stdout: '' };
      }

      const show = comando.match(/^ip route show (\S+)/);
      if (show) {
        const subnet = show[1];
        return { stdout: rutasEnKernel.has(subnet) ? `${subnet} via 10.8.1.2 dev tun0` : '' };
      }

      return { stdout: '' };
    });
  });

  it('ruta existente que se borra bien → eliminadas', async () => {
    rutasEnKernel.add('10.10.6.0/24');

    const r = await service.removeVpsRoutes('10.8.1.2', ['10.10.6.0/24']);

    expect(r.eliminadas).toEqual(['10.10.6.0/24']);
    expect(r.residuales).toEqual([]);
    expect(rutasEnKernel.has('10.10.6.0/24')).toBe(false);
  });

  it('ruta que ya no existía → ÉXITO idempotente, no fallo', async () => {
    // Reejecutar una limpieza ya aplicada no puede contar como error (directriz de
    // wizards, punto 8). Antes esto era indistinguible de un borrado real.
    const r = await service.removeVpsRoutes('10.8.1.2', ['192.168.6.0/24']);

    expect(r.noExistian).toEqual(['192.168.6.0/24']);
    expect(r.eliminadas).toEqual([]);
    expect(r.residuales).toEqual([]);
  });

  it('ruta que SOBREVIVE al borrado → residual, NUNCA éxito silencioso', async () => {
    // Es el caso que el código anterior no podía detectar de ninguna manera: el `|| true`
    // más el `catch {}` garantizaban que un residuo se reportara como limpieza correcta.
    rutasEnKernel.add('10.10.6.0/24');
    borradoFalla.add('10.10.6.0/24');

    const r = await service.removeVpsRoutes('10.8.1.2', ['10.10.6.0/24']);

    expect(r.residuales).toEqual(['10.10.6.0/24']);
    expect(r.eliminadas).toEqual([]);
  });

  it('el gateway cambiado ya no impide el borrado', async () => {
    // Defecto real: `ip route del <subnet> via <gateway>` sólo borra si el gateway
    // coincide exacto. Si el vpnIp del router cambió al re-registrarlo, el borrado no
    // encontraba nada y dejaba la ruta viva sin avisar. Ahora se borra por subnet.
    rutasEnKernel.add('10.10.6.0/24'); // creada en su día con OTRO gateway

    const r = await service.removeVpsRoutes('10.8.1.99', ['10.10.6.0/24']);

    expect(r.eliminadas).toEqual(['10.10.6.0/24']);
  });

  it('un residuo no aborta el resto: se procesan todas las subnets', async () => {
    // La baja de un router no puede detenerse porque una ruta se resista — quedaría
    // indeleteable. Se sigue y se reporta.
    rutasEnKernel.add('10.10.6.0/24');
    rutasEnKernel.add('192.168.6.0/24');
    borradoFalla.add('10.10.6.0/24');

    const r = await service.removeVpsRoutes('10.8.1.2', ['10.10.6.0/24', '192.168.6.0/24']);

    expect(r.residuales).toEqual(['10.10.6.0/24']);
    expect(r.eliminadas).toEqual(['192.168.6.0/24']);
  });

  it('lista vacía no rompe ni reporta nada', async () => {
    const r = await service.removeVpsRoutes('10.8.1.2', []);
    expect(r).toEqual({ eliminadas: [], noExistian: [], residuales: [] });
  });
});
