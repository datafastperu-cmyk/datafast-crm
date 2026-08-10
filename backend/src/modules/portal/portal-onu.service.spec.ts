import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Cache } from 'cache-manager';

import { PortalOnuService } from './portal-onu.service';
import { ProvisionFtthService } from '../olt-nativo/services/provision-ftth.service';
import { OnuTr069DetalleService, OnuTr069Detalle } from '../olt-nativo/ztp/onu-tr069-detalle.service';
import { ModuleHealthService } from '../../common/services/module-health.service';

// VIO en el portal: "aceptado" y "materializado" son estados distintos, y al abonado
// NUNCA se le dice "guardado" sin haberlo releído del equipo.
//
// Origen de la regla: incidente CNT-2026-000004 — una ONU aceptó sin error un comando
// que su firmware jamás aplicó, y el ERP reportó éxito durante días. Aquí el riesgo es el
// mismo: `setWifi` encola en GenieACS y devuelve ok sin esperar al CPE.
//
// Caso especial que estos tests fijan: la contraseña WiFi es WRITE-ONLY en TR-069 (el
// equipo nunca la devuelve), así que un cambio de clave NO es verificable por lectura y
// no puede reportarse como confirmado.

const CONTRATO = '11111111-1111-4111-8111-111111111111';
const CLIENTE  = '22222222-2222-4222-8222-222222222222';
const EMPRESA  = '33333333-3333-4333-8333-333333333333';

function detalleCon(ssid24: string | null, lastInform = new Date()): OnuTr069Detalle {
  return {
    informing: true,
    vivo: true,
    lastInform: lastInform.toISOString(),
    wifi: [
      { band: '2.4', index: 1, enabled: true, ssid: ssid24 },
      { band: '5',   index: 5, enabled: true, ssid: 'RED-5G' },
    ],
    hosts: [],
  };
}

describe('PortalOnuService — WiFi del abonado', () => {
  let svc: PortalOnuService;
  let detalle: jest.Mocked<Pick<OnuTr069DetalleService, 'isReady' | 'getDetalle' | 'refresh' | 'setWifi'>>;
  let cache: jest.Mocked<Pick<Cache, 'get' | 'set' | 'del'>>;
  let salud: jest.Mocked<Pick<ModuleHealthService, 'registrar'>>;

  const filaRegistro = {
    registro_id: 'reg-1',
    sn: 'SN-TEST-001',
    estado: 'activo',
    carril_estado: 'activo',
    contrato_estado: 'activo',
  };

  let filaActual: Record<string, string>;

  beforeEach(() => {
    filaActual = { ...filaRegistro };

    const dataSource = {
      query: jest.fn().mockImplementation(() => Promise.resolve([filaActual])),
    } as unknown as DataSource;

    detalle = {
      isReady:   jest.fn().mockReturnValue(true),
      getDetalle: jest.fn().mockResolvedValue(detalleCon('RED-VIEJA')),
      refresh:    jest.fn().mockResolvedValue(detalleCon('RED-VIEJA')),
      setWifi:    jest.fn().mockReturnValue({ ok: true, applied: 1, total: 1, fallidas: [] }),
    } as unknown as jest.Mocked<
      Pick<OnuTr069DetalleService, 'isReady' | 'getDetalle' | 'refresh' | 'setWifi'>
    >;

    cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<Pick<Cache, 'get' | 'set' | 'del'>>;

    salud = { registrar: jest.fn() } as unknown as jest.Mocked<
      Pick<ModuleHealthService, 'registrar'>
    >;

    const ftth = {
      activarCarril: jest.fn().mockResolvedValue({ estado: 'activando', mensaje: '' }),
      marcarUsoTr069: jest.fn().mockResolvedValue(undefined),
    } as unknown as ProvisionFtthService;

    svc = new PortalOnuService(
      dataSource,
      ftth,
      detalle as unknown as OnuTr069DetalleService,
      salud as unknown as ModuleHealthService,
      cache as unknown as Cache,
    );
  });

  describe('materialización (VIO)', () => {
    it('SSID releído del equipo → confirmado', async () => {
      detalle.getDetalle.mockResolvedValue(detalleCon('RED-NUEVA'));

      const res = await svc.guardarWifi(CLIENTE, EMPRESA, CONTRATO, '2.4', { ssid: 'RED-NUEVA' });

      expect(res.clase).toBe('confirmado');
      expect(detalle.setWifi).toHaveBeenCalledWith('SN-TEST-001', expect.objectContaining({
        band: '2.4', ssid: 'RED-NUEVA',
      }));
    });

    it('el equipo sigue reportando el SSID viejo → sin_confirmar, NUNCA "guardado"', async () => {
      // El equipo aceptó el comando pero no lo aplicó: exactamente el escenario del
      // incidente CNT-2026-000004 trasladado al CPE.
      detalle.getDetalle.mockResolvedValue(detalleCon('RED-VIEJA'));

      const res = await svc.guardarWifi(CLIENTE, EMPRESA, CONTRATO, '2.4', { ssid: 'RED-NUEVA' });

      expect(res.clase).toBe('sin_confirmar');
      expect(res.mensaje).not.toMatch(/listo/i);
      // Agota las 4 lecturas de verificación (~6 s reales) antes de rendirse.
    }, 20_000);

    it('cambio de solo contraseña → sin_confirmar: es write-only, no hay lectura posible', async () => {
      const res = await svc.guardarWifi(CLIENTE, EMPRESA, CONTRATO, '2.4', { password: 'claveSegura123' });

      expect(res.clase).toBe('sin_confirmar');
      // No se gasta ni un intento de lectura en algo que el protocolo no devuelve.
      expect(detalle.getDetalle).toHaveBeenCalledTimes(1); // solo el chequeo de sesión viva
    });
  });

  describe('validaciones de red', () => {
    it('rechaza contraseña de menos de 8 caracteres (mínimo WPA2)', async () => {
      await expect(
        svc.guardarWifi(CLIENTE, EMPRESA, CONTRATO, '2.4', { password: 'corta7c' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza contraseñas triviales', async () => {
      await expect(
        svc.guardarWifi(CLIENTE, EMPRESA, CONTRATO, '2.4', { password: '12345678' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza contraseña igual al nombre de la red', async () => {
      await expect(
        svc.guardarWifi(CLIENTE, EMPRESA, CONTRATO, '2.4', {
          ssid: 'MiRedWiFi', password: 'mirEdwifi',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza SSID de más de 32 caracteres', async () => {
      await expect(
        svc.guardarWifi(CLIENTE, EMPRESA, CONTRATO, '2.4', { ssid: 'x'.repeat(33) }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza una petición sin cambios', async () => {
      await expect(
        svc.guardarWifi(CLIENTE, EMPRESA, CONTRATO, '2.4', {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('quién puede escribir', () => {
    it('un servicio suspendido puede LEER pero no escribir', async () => {
      filaActual.contrato_estado = 'suspendido';

      await expect(
        svc.guardarWifi(CLIENTE, EMPRESA, CONTRATO, '2.4', { ssid: 'RED-NUEVA' }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      // La lectura sigue disponible: ver su propia red no cambia nada en el equipo.
      await expect(svc.wifi(CLIENTE, EMPRESA, CONTRATO)).resolves.toMatchObject({
        editable: false,
      });
    });

    it('sin carril conectado no se puede escribir', async () => {
      filaActual.carril_estado = 'inactivo';

      await expect(
        svc.guardarWifi(CLIENTE, EMPRESA, CONTRATO, '2.4', { ssid: 'RED-NUEVA' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('con la sesión TR-069 rancia no se puede escribir', async () => {
      // Sesión de hace 2 horas: un task se encolaría pero podría no entregarse nunca.
      const viejo = new Date(Date.now() - 2 * 60 * 60_000);
      detalle.getDetalle.mockResolvedValue(detalleCon('RED-VIEJA', viejo));

      await expect(
        svc.guardarWifi(CLIENTE, EMPRESA, CONTRATO, '2.4', { ssid: 'RED-NUEVA' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('alcanzado el máximo de cambios diarios, se rechaza', async () => {
      // Solo el contador diario; sin marca de escritura reciente.
      cache.get.mockImplementation(async (clave: string) =>
        clave.startsWith('portal_wifi_cambios') ? 99 : undefined);

      await expect(
        svc.guardarWifi(CLIENTE, EMPRESA, CONTRATO, '2.4', { ssid: 'RED-NUEVA' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('dos escrituras seguidas: la segunda espera, y dice cuántos segundos', async () => {
      // Configurar las dos bandas son dos escrituras seguidas; lo que hay que evitar es
      // martillear el equipo, no que el abonado termine de configurar su casa.
      cache.get.mockImplementation(async (clave: string) =>
        clave.startsWith('portal_wifi_ultimo') ? Date.now() - 5_000 : 0);

      await expect(
        svc.guardarWifi(CLIENTE, EMPRESA, CONTRATO, '5', { ssid: 'RED-5G-NUEVA' }),
      ).rejects.toThrow(/\d+\s*segundos/);
    });
  });

  // Un intento que falla no puede gastarle el cupo al abonado: no es culpa suya.
  describe('el cupo solo lo consume una escritura despachada', () => {
    it('si la escritura falla, NO se registra el cambio', async () => {
      cache.get.mockResolvedValue(0);
      detalle.setWifi.mockImplementation(() => {
        throw new Error('ACS no disponible');
      });

      await expect(
        svc.guardarWifi(CLIENTE, EMPRESA, CONTRATO, '2.4', { ssid: 'RED-NUEVA' }),
      ).rejects.toThrow();

      const registros = cache.set.mock.calls.filter(
        ([clave]) => String(clave).startsWith('portal_wifi_'),
      );
      expect(registros).toHaveLength(0);
    });

    it('si la escritura se despacha, se registra el cambio y la marca de tiempo', async () => {
      cache.get.mockResolvedValue(0);
      detalle.getDetalle.mockResolvedValue(detalleCon('RED-NUEVA'));

      await svc.guardarWifi(CLIENTE, EMPRESA, CONTRATO, '2.4', { ssid: 'RED-NUEVA' });

      const claves = cache.set.mock.calls.map(([c]) => String(c));
      expect(claves.some((c) => c.startsWith('portal_wifi_cambios'))).toBe(true);
      expect(claves.some((c) => c.startsWith('portal_wifi_ultimo'))).toBe(true);
    });
  });

  describe('conectar el router', () => {
    it('no permite un segundo intento dentro de la ventana de espera', async () => {
      // Sin este freno, un abonado impaciente —o muchos a la vez— abre sesiones SSH
      // contra la OLT, que admite pocas VTY concurrentes.
      cache.get.mockResolvedValue(1);

      await expect(
        svc.conectar(CLIENTE, EMPRESA, CONTRATO),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('lectura de estado', () => {
    it('sin ONU registrada informa el motivo, no un error', async () => {
      const dataSourceVacio = { query: jest.fn().mockResolvedValue([]) } as unknown as DataSource;
      const svcVacio = new PortalOnuService(
        dataSourceVacio,
        { activarCarril: jest.fn(), marcarUsoTr069: jest.fn() } as unknown as ProvisionFtthService,
        detalle as unknown as OnuTr069DetalleService,
        salud as unknown as ModuleHealthService,
        cache as unknown as Cache,
      );

      await expect(svcVacio.estado(CLIENTE, EMPRESA, CONTRATO)).resolves.toMatchObject({
        disponible: false,
        motivo: 'sin_onu',
      });
    });

    it('con GenieACS no configurado la sección se marca no disponible, no revienta', async () => {
      detalle.isReady.mockReturnValue(false);

      await expect(svc.estado(CLIENTE, EMPRESA, CONTRATO)).resolves.toMatchObject({
        disponible: false,
        motivo: 'acs_degradado',
      });
    });
  });

  // La degradación tiene que ser VISIBLE para el operador, no solo para el abonado: sin
  // esto, un ACS caído se descubre cuando alguien llama diciendo que no puede cambiar su
  // WiFi, en vez de mirando /health/modules.
  describe('salud publicada del módulo', () => {
    it('con GenieACS configurado se registra ok', () => {
      detalle.isReady.mockReturnValue(true);
      svc.onModuleInit();

      expect(salud.registrar).toHaveBeenCalledWith('portal-red', 'ok');
    });

    it('sin GenieACS se registra degradado con el motivo', () => {
      detalle.isReady.mockReturnValue(false);
      svc.onModuleInit();

      expect(salud.registrar).toHaveBeenCalledWith(
        'portal-red', 'degraded', expect.stringContaining('GenieACS'),
      );
    });

    it('si el probe revienta NO relanza: crashearía el backend por una sección opcional', () => {
      detalle.isReady.mockImplementation(() => { throw new Error('boom'); });

      expect(() => svc.onModuleInit()).not.toThrow();
      expect(salud.registrar).toHaveBeenCalledWith(
        'portal-red', 'degraded', expect.stringContaining('boom'),
      );
    });
  });
});
