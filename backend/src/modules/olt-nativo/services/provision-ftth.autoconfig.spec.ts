import { NotFoundException } from '@nestjs/common';
import { ProvisionFtthService } from './provision-ftth.service';

// El auto-config (SSID, clave WiFi, credenciales de acceso web) se aplica DENTRO del bootstrap
// del carril, en cuanto la convergencia queda confirmada. Antes lo escribía el watcher de
// re-inyección —polling cada 2 minutos— o el reconcile de las 03:30: para una instalación de
// campo, donde el técnico no puede esperar más de uno o dos minutos frente a la ONU, ninguno
// de los dos sirve.
//
// Estos tests fijan lo que hace seguro aplicarlo ahí: el carril YA está materializado cuando
// esto corre, así que ningún fallo del auto-config puede tumbarlo ni reportarse como éxito.
describe('ProvisionFtthService — auto-config inmediato tras converger el carril', () => {
  const hacer = (provisionContract: jest.Mock) => {
    const svc = Object.create(ProvisionFtthService.prototype) as any;
    svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    svc.ztp = { provisionContract };
    return svc;
  };

  it('aplicado: se lo confirma al operador en el mensaje que recibe en campo', async () => {
    const svc = hacer(jest.fn(async () => ({ ok: true, applied: 4, total: 4, mensaje: 'ok' })));
    const nota = await svc._autoConfigInmediato('c-1', 'e-1');

    expect(nota).toContain('WiFi');
    expect(svc.ztp.provisionContract).toHaveBeenCalledWith('c-1', 'e-1');
  });

  it('no aplicado: lo dice explícitamente — nunca éxito silencioso (VIO)', async () => {
    const svc = hacer(jest.fn(async () => ({
      ok: false, mensaje: 'La ONU HWTC1234 aún no aparece en GenieACS (no ha informado).',
    })));
    const nota = await svc._autoConfigInmediato('c-1', 'e-1');

    expect(nota).toMatch(/no se aplicó/i);
    // El watcher de re-inyección sigue siendo la red de seguridad: last_applied_revision no
    // avanzó, así que lo recogerá. El operador tiene que saber que quedó pendiente.
    expect(nota).toMatch(/reintenta/i);
  });

  it('un fallo del auto-config NUNCA tumba el bootstrap: el carril ya está materializado', async () => {
    const svc = hacer(jest.fn(async () => { throw new Error('GenieACS caído'); }));

    // Si esto lanzara, revertiría un carril que está bien — el peor de los desenlaces:
    // perder una operación de hardware confirmada por un problema del plano de configuración.
    await expect(svc._autoConfigInmediato('c-1', 'e-1')).resolves.toMatch(/no se aplicó/i);
  });

  it('contrato sin preset de ONU: no se anuncia nada, no es un fallo', async () => {
    const svc = hacer(jest.fn(async () => { throw new NotFoundException('sin contrato_onu_config'); }));
    await expect(svc._autoConfigInmediato('c-1', 'e-1')).resolves.toBe('');
  });

  it('provisioning deshabilitado: se omite en silencio', async () => {
    const svc = hacer(jest.fn(async () => ({ ok: false, skipped: true, mensaje: 'provisioning_enabled = false' })));
    await expect(svc._autoConfigInmediato('c-1', 'e-1')).resolves.toBe('');
  });
});
