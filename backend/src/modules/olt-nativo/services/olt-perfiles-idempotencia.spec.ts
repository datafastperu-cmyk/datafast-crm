import { OltSrvProfileService } from './olt-srvprofile.service';
import { OltLineProfileService } from './olt-lineprofile.service';

// Pedir un perfil que YA EXISTE es un no-op exitoso, no un conflicto: la operación ya está
// en su destino. Ambos servicios lanzaban 409 y eso BLOQUEABA el aprovisionamiento — la ONU
// que llega suele ser del mismo modelo que otra ya aprovisionada, que es el caso NORMAL, no
// la excepción. Ocurrió en campo el 2026-07-29, con el técnico y la ONU delante:
// "El tipo de ONU DATAFAST_EG8145V5 ya existe en esta OLT (profile-id 19)".
//
// Es la misma regla escrita tras el incidente de los 1788 reintentos contra el MA5800: la
// idempotencia se DERIVA del estado destino. Estos dos servicios se habían quedado fuera.
describe('Perfiles de OLT — idempotencia por nombre sellado', () => {
  const oltMock = { id: 'olt-1', empresaId: 'e-1' };

  describe('OltSrvProfileService (tipos de ONU)', () => {
    const hacer = (existente: any | null) => {
      const svc = Object.create(OltSrvProfileService.prototype) as any;
      svc.logger  = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
      svc.oltRepo = { findOne: jest.fn(async () => oltMock) };
      svc.repo    = { findOne: jest.fn(async () => existente), save: jest.fn(), create: jest.fn() };
      svc.connService = { buildConn: jest.fn(async () => ({})) };
      svc.automation  = { srvProfileAdd: jest.fn(async () => ({ success: true, profile_id: 99 })) };
      return svc;
    };

    it('devuelve el perfil existente en vez de lanzar 409', async () => {
      const yaExiste = { profileId: 19, nombre: 'DATAFAST_EG8145V5', origen: 'erp' };
      const svc = hacer(yaExiste);

      const r = await svc.agregarConCli('olt-1', 'e-1', { modelo: 'EG8145V5', eth: 4, pots: 0, catv: 0 });

      expect(r).toBe(yaExiste);
      // Y NO vuelve a tocar la OLT: reenviar el comando por algo que ya está aplicado es
      // exactamente el martilleo que agota las sesiones VTY del MA5800.
      expect(svc.automation.srvProfileAdd).not.toHaveBeenCalled();
    });

    it('el modelo se compara con el nombre SELLADO, no con el crudo', async () => {
      const svc = hacer(null);
      svc.repo.create = jest.fn((d: any) => d);
      svc.repo.save   = jest.fn(async (d: any) => d);
      await svc.agregarConCli('olt-1', 'e-1', { modelo: 'eg8145v5', eth: 4, pots: 0, catv: 0 });

      // Sin el sello buscaría "EG8145V5" —que existe pero es de la OLT, no del ERP— y
      // creería que ya está hecho, saltándose la creación del suyo.
      expect(svc.repo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ nombre: 'DATAFAST_EG8145V5' }) }),
      );
    });

    it('si no existe, sigue creándolo contra la OLT', async () => {
      const svc = hacer(null);
      svc.repo.create = jest.fn((d: any) => d);
      svc.repo.save   = jest.fn(async (d: any) => d);

      const r = await svc.agregarConCli('olt-1', 'e-1', { modelo: 'HG8145X6', eth: 4, pots: 0, catv: 0 });

      expect(svc.automation.srvProfileAdd).toHaveBeenCalled();
      expect(r.profileId).toBe(99);
    });
  });

  describe('OltLineProfileService', () => {
    const hacer = (existente: any | null) => {
      const svc = Object.create(OltLineProfileService.prototype) as any;
      svc.logger  = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
      svc.oltRepo = { findOne: jest.fn(async () => oltMock) };
      svc.repo    = { findOne: jest.fn(async () => existente), save: jest.fn(), create: jest.fn() };
      svc.connService = { buildConn: jest.fn(async () => ({})) };
      svc.automation  = { lineProfileAdd: jest.fn(async () => ({ success: true, profile_id: 77 })) };
      return svc;
    };

    it('devuelve el line-profile existente sin volver a tocar la OLT', async () => {
      const yaExiste = { profileId: 10, nombre: 'DATAFAST_GPON-1G', origen: 'erp' };
      const svc = hacer(yaExiste);

      const r = await svc.agregarConCli('olt-1', 'e-1', { nombre: 'gpon-1g', dbaMaxMbps: 100 });

      expect(r).toBe(yaExiste);
      expect(svc.automation.lineProfileAdd).not.toHaveBeenCalled();
    });
  });
});
