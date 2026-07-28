import { CwmpAuthService } from './cwmp-auth.service';

// El endurecimiento CWMP quedó DESACTIVADO por defecto (2026-07-28) porque
// ManagementServer.Password es write-only en la EG8145V5: su materialización no es
// observable y por tanto no puede cumplir VIO. Estos tests fijan esa decisión — que
// se reactive por descuido reintroduce el deadlock de gestión del 24/07.
describe('CwmpAuthService — política de endurecimiento', () => {
  const svc = new CwmpAuthService({ registrar: jest.fn() } as any);

  const conEnv = (vals: Record<string, string | undefined>, fn: () => void) => {
    const previo: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vals)) {
      previo[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try { fn(); } finally {
      for (const [k, v] of Object.entries(previo)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };

  it('con secreto pero SIN CWMP_AUTH_ENFORCE, NO endurece', () => {
    conEnv({ CWMP_AUTH_SECRET: 'x'.repeat(32), CWMP_AUTH_ENFORCE: undefined }, () => {
      expect(svc.isEnabled()).toBe(true);            // el HMAC sigue siendo derivable
      expect(svc.isEnforcementEnabled()).toBe(false); // pero no se aplica el tag
    });
  });

  it('CWMP_AUTH_ENFORCE=false explícito tampoco endurece', () => {
    conEnv({ CWMP_AUTH_SECRET: 'x'.repeat(32), CWMP_AUTH_ENFORCE: 'false' }, () => {
      expect(svc.isEnforcementEnabled()).toBe(false);
    });
  });

  it('CWMP_AUTH_ENFORCE=true reactiva el endurecimiento (opt-in explícito)', () => {
    conEnv({ CWMP_AUTH_SECRET: 'x'.repeat(32), CWMP_AUTH_ENFORCE: 'true' }, () => {
      expect(svc.isEnforcementEnabled()).toBe(true);
    });
  });

  it('sin secreto NO endurece aunque el flag esté en true (no habría HMAC que exigir)', () => {
    conEnv({ CWMP_AUTH_SECRET: undefined, CWMP_AUTH_ENFORCE: 'true' }, () => {
      expect(svc.isEnabled()).toBe(false);
      expect(svc.isEnforcementEnabled()).toBe(false);
    });
  });

  it('derive sigue siendo determinista: el HMAC no cambia con la política', () => {
    conEnv({ CWMP_AUTH_SECRET: 'secreto-de-prueba' }, () => {
      const a = svc.derive('4857544378CA0FAA');
      const b = svc.derive('4857544378CA0FAA');
      expect(a).toBe(b);
      expect(a).toHaveLength(16);
      expect(a).toMatch(/^[A-Za-z0-9]+$/);
    });
  });
});
