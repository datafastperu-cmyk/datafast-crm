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
  // `pendiente` = hay drift (nunca aplicado, o la config del ERP cambió).
  const hacer = (provisionContract: jest.Mock, pendiente = true) => {
    const svc = Object.create(ProvisionFtthService.prototype) as any;
    svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    svc.ztp = { provisionContract };
    svc.ds = { query: jest.fn(async () => [{ pendiente }]) };
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

  it('NO reescribe la ONU si el auto-config ya está aplicado y sin cambios', async () => {
    // El auto-config pertenece al aprovisionamiento: escribe la config de fábrica del ERP
    // UNA vez. Pasado eso la ONU es del abonado —pudo cambiar su clave de WiFi— y esta ruta
    // corre también cuando alguien activa el carril TR-069 solo para consultar un dato.
    // Reescribirle la configuración por eso sería pisar lo suyo sin pedírselo.
    const provisionContract = jest.fn();
    const svc = hacer(provisionContract, /* pendiente */ false);

    await expect(svc._autoConfigInmediato('c-1', 'e-1')).resolves.toBe('');
    expect(provisionContract).not.toHaveBeenCalled();
  });

  it('SÍ aplica cuando hay drift: alta inicial, factory reset o cambio en el ERP', async () => {
    // Los tres casos convergen en el mismo criterio: last_applied_revision NULL (alta y
    // post-factory-reset) o menor que revision (el operador cambió el SSID en el ERP).
    const provisionContract = jest.fn(async () => ({ ok: true, applied: 4, total: 4, mensaje: 'ok' }));
    const svc = hacer(provisionContract, /* pendiente */ true);

    await svc._autoConfigInmediato('c-1', 'e-1');
    expect(provisionContract).toHaveBeenCalled();
  });

  it('provisioning deshabilitado: se omite en silencio', async () => {
    const svc = hacer(jest.fn(async () => ({ ok: false, skipped: true, mensaje: 'provisioning_enabled = false' })));
    await expect(svc._autoConfigInmediato('c-1', 'e-1')).resolves.toBe('');
  });
});

// El carril TR-069 se encola FUERA del lock de provisión. Encolarlo desde dentro hacía que
// el outbox lo recogiera al instante y chocara contra ese mismo lock ("Ya hay un
// aprovisionamiento en curso"): el rechazo es reintentable, pero el reintento caía en el
// cron. Medido en campo el 2026-07-29: encolado 13:11:40, aplicado 13:15:33 — 3,5 minutos
// de espera por una colisión contra nosotros mismos.
describe('ProvisionFtthService — el carril se encola tras soltar el lock', () => {
  const hacer = (resInterno: any) => {
    const svc = Object.create(ProvisionFtthService.prototype) as any;
    const emitidos: Array<{ ev: string; payload: any }> = [];
    let lockTomado = false;
    let lockSueltoAlEmitir: boolean | null = null;

    svc.events = { emit: jest.fn((ev: string, payload: any) => {
      lockSueltoAlEmitir = !lockTomado;
      emitidos.push({ ev, payload });
      return true;
    }) };
    svc.opLock = { conLock: jest.fn(async (_c: string, _op: string, fn: any) => {
      lockTomado = true;
      try { return await fn(); } finally { lockTomado = false; }
    }) };
    svc._provisionarFtthInterno = jest.fn(async () => resInterno);

    return { svc, emitidos, verLockSuelto: () => lockSueltoAlEmitir };
  };

  it('emite el evento del carril SOLO cuando el lock ya se soltó', async () => {
    const { svc, emitidos, verLockSuelto } = hacer({
      estado: 'activo', registroId: 'r-1', mensaje: 'ok', pendienteCarrilTr069: true,
    });

    await svc.provisionarFtth('olt-1', 'e-1', { contratoId: 'c-1' } as any);

    expect(emitidos.map((e) => e.ev)).toContain('ftth.carril.activar');
    // La aserción que importa: si esto es false, el outbox volverá a chocar con el lock.
    expect(verLockSuelto()).toBe(true);
  });

  it('no encola nada si la provisión no lo pidió (flag apagado o OLT sin TR-069)', async () => {
    const { svc, emitidos } = hacer({ estado: 'activo', registroId: 'r-1', mensaje: 'ok' });
    await svc.provisionarFtth('olt-1', 'e-1', { contratoId: 'c-1' } as any);
    expect(emitidos).toHaveLength(0);
  });
});
