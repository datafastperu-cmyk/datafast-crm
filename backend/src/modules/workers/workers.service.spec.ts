import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken }  from '@nestjs/typeorm';
import { EventEmitter2 }       from '@nestjs/event-emitter';
import { getQueueToken }       from '@nestjs/bull';

import { CobranzaWorker }      from './cobranza.worker';
import { FacturacionWorker }   from './facturacion.worker';
import { FirewallService }     from '../mikrotik/services/firewall.service';
import { PppoeService }        from '../mikrotik/services/pppoe.service';
import { FacturacionService }  from '../facturacion/facturacion.service';
import { AuditoriaService }    from '../auth/auditoria.service';
import { OutboxRedService } from '../outbox-red/outbox-red.service';
import { RedisLockService } from '../../common/redis/redis-lock.service';
import { SchedulerRegistry } from '@nestjs/schedule';
import { EmpresaConfigService } from '../config/empresa-config.service';
import { GatewayMensajeriaService } from '../notificaciones/services/gateway-mensajeria.service';
import { QUEUES }              from './workers.constants';

// ── Fixtures ──────────────────────────────────────────────────
const mockRouter = {
  ip_gestion: '192.168.100.1', usuario: 'admin',
  password_cifrado: 'encryptedpass', usar_ssl: false,
  puerto_api: 8728, puerto_api_ssl: 8729,
  version_ros: 'v7', timeout_conexion: 10,
};

const mockContrato = {
  id: 'cnt-001', deuda_total: 85.00, meses_deuda: 1,
  router_id: 'rtr-001', ip_asignada: '192.168.1.2',
  usuario_pppoe: 'cli_abc', estado: 'suspendido',
  plan_nombre: 'Plan 30 Mbps',
};

const mockCliente = {
  nombre_completo: 'Juan Pérez', whatsapp: '987654321', telefono: '987654321',
  empresa_nombre: 'CRM ISP DATAFAST',
};

const mockEmpresa = {
  id: 'emp-001', razon_social: 'CRM ISP DATAFAST',
  igv_rate: 0.18, serie_boleta: 'B001',
};

const mockContratoFactura = {
  contrato_id: 'cnt-001', numero_contrato: 'CNT-2024-000001',
  cliente_id: 'cli-001', precio: 85.00, dia_facturacion: 1,
  cliente_nombre: 'Juan Pérez', whatsapp: '987654321',
  aplica_igv: true, plan_nombre: 'Plan 30 Mbps',
};

// ── Mock Bull Job ──────────────────────────────────────────────
function createMockJob<T>(data: T, name = 'test-job') {
  return {
    id: '1', name,
    data,
    opts: { attempts: 3 },
    attemptsMade: 0,
    progress: jest.fn().mockResolvedValue(undefined),
  };
}

// ── Mocks de servicios ────────────────────────────────────────
const mockFirewall = {
  suspenderCliente:        jest.fn().mockResolvedValue(undefined),
  reactivarCliente:        jest.fn().mockResolvedValue(undefined),
  configurarReglasControl: jest.fn().mockResolvedValue(undefined),
};

const mockPppoe = {
  desconectarSesion: jest.fn().mockResolvedValue(undefined),
  crear:             jest.fn().mockResolvedValue('*1'),
  // Suspender ya no es solo desconectar la sesión: además DESHABILITA el secret
  // (`setEstado(creds, usuario, true)`). Sin esto el cliente se reconectaba al instante
  // — desconectar sin deshabilitar no suspende a nadie.
  setEstado:         jest.fn().mockResolvedValue(undefined),
  eliminar:          jest.fn().mockResolvedValue(undefined),
};

const mockWhatsapp = {
  notificarServicioSuspendido: jest.fn().mockResolvedValue({ enviado: true }),
  notificarServicioReactivado: jest.fn().mockResolvedValue({ enviado: true }),
  notificarFacturaEmitida:     jest.fn().mockResolvedValue({ enviado: true }),
  notificarPagoRecibido:       jest.fn().mockResolvedValue({ enviado: true }),
  enviar:                      jest.fn().mockResolvedValue({ enviado: true }),
};

const mockFacturacionSvc = {
  aplicarPago:    jest.fn().mockResolvedValue({ id: 'fac-001', estado: 'pagada' }),
  generarMensual: jest.fn().mockResolvedValue({ exitosas: 1, omitidas: 0, errores: 0, detalles: [] }),
};

const mockAuditoria = { log: jest.fn() };
const mockEvents    = { emit: jest.fn() };

// ─────────────────────────────────────────────────────────────
// CobranzaWorker Tests
// ─────────────────────────────────────────────────────────────
describe('CobranzaWorker', () => {
  let worker: CobranzaWorker;

  // Sequence: router, cliente
  const buildDsMock = (extraRows?: any[]) => {
    const m = jest.fn();
    m.mockResolvedValueOnce([mockRouter])       // getRouter
      .mockResolvedValueOnce([])                // UPDATE contratos (suspender)
      .mockResolvedValueOnce([])                // INSERT historial
      .mockResolvedValueOnce([mockCliente])     // getCliente para WhatsApp
      .mockResolvedValue([]);                   // resto
    return m;
  };

  beforeEach(async () => {
    const m: TestingModule = await Test.createTestingModule({
      providers: [
        CobranzaWorker,
        { provide: FirewallService,    useValue: mockFirewall },
        { provide: PppoeService,       useValue: mockPppoe },
        { provide: FacturacionService, useValue: mockFacturacionSvc },
        { provide: AuditoriaService,   useValue: mockAuditoria },
        { provide: GatewayMensajeriaService, useValue: mockWhatsapp },
        { provide: OutboxRedService,   useValue: { encolar: jest.fn().mockResolvedValue(undefined), encolarDesprovisionar: jest.fn().mockResolvedValue(undefined), encolarOnu: jest.fn().mockResolvedValue(undefined) } },
        { provide: RedisLockService,   useValue: {
          // Firma real: withLock(clave, ttlMs, fn). Ejecutar el 2º argumento (el TTL)
          // hacía que el trabajo dentro del lock no corriera NUNCA y el test fallara
          // sin ninguna llamada al hardware.
          withLock: jest.fn(async (...args: any[]) => {
            const fn = args.find((a) => typeof a === 'function');
            return fn ? fn() : undefined;
          }),
          adquirir: jest.fn(), liberar: jest.fn(),
        } },
        { provide: SchedulerRegistry,  useValue: { addCronJob: jest.fn(), deleteCronJob: jest.fn(), doesExist: jest.fn(() => false) } },
        { provide: EmpresaConfigService, useValue: { get: jest.fn(), obtener: jest.fn() } },
        { provide: 'PROVISIONAMIENTO_PROVIDER', useValue: {
          // El worker delega en el proveedor (patrón Estrategia) y ABORTA si devuelve
          // falsy: sin un valor por defecto, jest.fn() devuelve undefined y la
          // reactivación se rechaza siempre.
          reactivarServicio:   jest.fn().mockResolvedValue(true),
          suspenderServicio:   jest.fn().mockResolvedValue(true),
          provisionarServicio: jest.fn().mockResolvedValue(true),
        } },
        { provide: EventEmitter2,      useValue: mockEvents },
        { provide: getDataSourceToken(), useValue: { query: buildDsMock() } },
      ],
    }).compile();
    worker = m.get<CobranzaWorker>(CobranzaWorker);
  });

  afterEach(() => jest.clearAllMocks());

  // ── Suspender contrato ────────────────────────────────────
  describe('processSuspenderContrato()', () => {
    it('debe agregar IP a morosos y desconectar PPPoE', async () => {
      const job = createMockJob({
        contratoId: 'cnt-001', empresaId: 'emp-001', clienteId: 'cli-001',
        routerId: 'rtr-001', ipAsignada: '192.168.1.2', usuarioPppoe: 'cli_abc',
        deudaTotal: 85, mesesDeuda: 1, notificar: true,
      });

      const result = await worker.processSuspenderContrato(job as any);

      expect(mockFirewall.suspenderCliente).toHaveBeenCalledWith(
        expect.objectContaining({ ip: '192.168.100.1' }),
        '192.168.1.2', 'cli-001', expect.any(String),
      );
      expect(mockPppoe.desconectarSesion).toHaveBeenCalledWith(
        expect.anything(), 'cli_abc',
      );
      expect(result.errores).toHaveLength(0);
    });

    it('debe continuar sin el router si no se encuentra', async () => {
      const dsMock = jest.fn()
        .mockResolvedValueOnce([])    // router no encontrado
        .mockResolvedValue([]);       // resto

      const m = await Test.createTestingModule({
        providers: [
          CobranzaWorker,
          { provide: FirewallService,    useValue: mockFirewall },
          { provide: PppoeService,       useValue: mockPppoe },
          { provide: FacturacionService, useValue: mockFacturacionSvc },
          { provide: AuditoriaService,   useValue: mockAuditoria },
        { provide: GatewayMensajeriaService, useValue: mockWhatsapp },
        { provide: OutboxRedService,   useValue: { encolar: jest.fn().mockResolvedValue(undefined), encolarDesprovisionar: jest.fn().mockResolvedValue(undefined), encolarOnu: jest.fn().mockResolvedValue(undefined) } },
        { provide: RedisLockService,   useValue: {
          // Firma real: withLock(clave, ttlMs, fn). Ejecutar el 2º argumento (el TTL)
          // hacía que el trabajo dentro del lock no corriera NUNCA y el test fallara
          // sin ninguna llamada al hardware.
          withLock: jest.fn(async (...args: any[]) => {
            const fn = args.find((a) => typeof a === 'function');
            return fn ? fn() : undefined;
          }),
          adquirir: jest.fn(), liberar: jest.fn(),
        } },
        { provide: SchedulerRegistry,  useValue: { addCronJob: jest.fn(), deleteCronJob: jest.fn(), doesExist: jest.fn(() => false) } },
        { provide: EmpresaConfigService, useValue: { get: jest.fn(), obtener: jest.fn() } },
        { provide: 'PROVISIONAMIENTO_PROVIDER', useValue: {
          // El worker delega en el proveedor (patrón Estrategia) y ABORTA si devuelve
          // falsy: sin un valor por defecto, jest.fn() devuelve undefined y la
          // reactivación se rechaza siempre.
          reactivarServicio:   jest.fn().mockResolvedValue(true),
          suspenderServicio:   jest.fn().mockResolvedValue(true),
          provisionarServicio: jest.fn().mockResolvedValue(true),
        } },
          { provide: EventEmitter2,      useValue: mockEvents },
          { provide: getDataSourceToken(), useValue: { query: dsMock } },
        ],
      }).compile();
      const w = m.get<CobranzaWorker>(CobranzaWorker);

      const job = createMockJob({
        contratoId: 'cnt-001', empresaId: 'emp-001', clienteId: 'cli-001',
        routerId: 'rtr-no-existe', ipAsignada: '192.168.1.2',
        usuarioPppoe: 'cli_abc', deudaTotal: 85, mesesDeuda: 1,
      });

      const result = await w.processSuspenderContrato(job as any);

      // Debe tener un error por router no encontrado pero no lanzar excepción
      // `toContain` compara por identidad y NO admite matchers: con un
      // `expect.stringContaining` dentro siempre falla, aunque el array tenga el texto.
      // Para buscar por patrón dentro de un array hay que usar arrayContaining.
      expect(result.errores).toEqual(
        expect.arrayContaining([expect.stringContaining('no encontrado')]),
      );
      expect(mockFirewall.suspenderCliente).not.toHaveBeenCalled();
    });

    it('debe notificar por WhatsApp cuando notificar=true', async () => {
      const dsMock = jest.fn()
        .mockResolvedValueOnce([mockRouter])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([mockCliente])
        .mockResolvedValue([]);

      const m = await Test.createTestingModule({
        providers: [
          CobranzaWorker,
          { provide: FirewallService,    useValue: mockFirewall },
          { provide: PppoeService,       useValue: mockPppoe },
          { provide: FacturacionService, useValue: mockFacturacionSvc },
          { provide: AuditoriaService,   useValue: mockAuditoria },
        { provide: GatewayMensajeriaService, useValue: mockWhatsapp },
        { provide: OutboxRedService,   useValue: { encolar: jest.fn().mockResolvedValue(undefined), encolarDesprovisionar: jest.fn().mockResolvedValue(undefined), encolarOnu: jest.fn().mockResolvedValue(undefined) } },
        { provide: RedisLockService,   useValue: {
          // Firma real: withLock(clave, ttlMs, fn). Ejecutar el 2º argumento (el TTL)
          // hacía que el trabajo dentro del lock no corriera NUNCA y el test fallara
          // sin ninguna llamada al hardware.
          withLock: jest.fn(async (...args: any[]) => {
            const fn = args.find((a) => typeof a === 'function');
            return fn ? fn() : undefined;
          }),
          adquirir: jest.fn(), liberar: jest.fn(),
        } },
        { provide: SchedulerRegistry,  useValue: { addCronJob: jest.fn(), deleteCronJob: jest.fn(), doesExist: jest.fn(() => false) } },
        { provide: EmpresaConfigService, useValue: { get: jest.fn(), obtener: jest.fn() } },
        { provide: 'PROVISIONAMIENTO_PROVIDER', useValue: {
          // El worker delega en el proveedor (patrón Estrategia) y ABORTA si devuelve
          // falsy: sin un valor por defecto, jest.fn() devuelve undefined y la
          // reactivación se rechaza siempre.
          reactivarServicio:   jest.fn().mockResolvedValue(true),
          suspenderServicio:   jest.fn().mockResolvedValue(true),
          provisionarServicio: jest.fn().mockResolvedValue(true),
        } },
          { provide: EventEmitter2,      useValue: mockEvents },
          { provide: getDataSourceToken(), useValue: { query: dsMock } },
        ],
      }).compile();
      const w = m.get<CobranzaWorker>(CobranzaWorker);

      await w.processSuspenderContrato(createMockJob({
        contratoId: 'cnt-001', empresaId: 'emp-001', clienteId: 'cli-001',
        routerId: 'rtr-001', ipAsignada: '192.168.1.2', usuarioPppoe: 'cli_abc',
        deudaTotal: 85, mesesDeuda: 1, notificar: true,
      }) as any);

      // La notificación dejó de ser una llamada directa a WhatsApp: el worker EMITE un
      // evento de dominio y quien lo entrega (WhatsApp, SMS, lo que sea) se suscribe.
      // Así el corte no depende de que el gateway de mensajería esté disponible — un
      // fallo al notificar no puede impedir suspender a un moroso.
      expect(mockEvents.emit).toHaveBeenCalledWith(
        expect.stringContaining('suspendido'),
        expect.objectContaining({ clienteNombre: 'Juan Pérez' }),
      );
    });

    it('debe emitir evento WebSocket al suspender', async () => {
      await worker.processSuspenderContrato(createMockJob({
        contratoId: 'cnt-001', empresaId: 'emp-001', clienteId: 'cli-001',
        routerId: 'rtr-001', ipAsignada: '192.168.1.2', usuarioPppoe: 'cli_abc',
        deudaTotal: 85, mesesDeuda: 1, notificar: false,
      }) as any);

      expect(mockEvents.emit).toHaveBeenCalledWith(
        'mikrotik.cliente.suspendido',
        expect.objectContaining({ clienteId: 'cli-001', ip: '192.168.1.2' }),
      );
    });
  });

  // ── Reactivar contrato ────────────────────────────────────
  describe('handleReactivarContrato()', () => {
    it('debe quitar IP de Address Lists y notificar', async () => {
      const dsMock = jest.fn()
        .mockResolvedValueOnce([mockRouter])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ nombre_completo: 'Juan', whatsapp: '987654321' }])
        .mockResolvedValue([]);

      const m = await Test.createTestingModule({
        providers: [
          CobranzaWorker,
          { provide: FirewallService,    useValue: mockFirewall },
          { provide: PppoeService,       useValue: mockPppoe },
          { provide: FacturacionService, useValue: mockFacturacionSvc },
          { provide: AuditoriaService,   useValue: mockAuditoria },
        { provide: GatewayMensajeriaService, useValue: mockWhatsapp },
        { provide: OutboxRedService,   useValue: { encolar: jest.fn().mockResolvedValue(undefined), encolarDesprovisionar: jest.fn().mockResolvedValue(undefined), encolarOnu: jest.fn().mockResolvedValue(undefined) } },
        { provide: RedisLockService,   useValue: {
          // Firma real: withLock(clave, ttlMs, fn). Ejecutar el 2º argumento (el TTL)
          // hacía que el trabajo dentro del lock no corriera NUNCA y el test fallara
          // sin ninguna llamada al hardware.
          withLock: jest.fn(async (...args: any[]) => {
            const fn = args.find((a) => typeof a === 'function');
            return fn ? fn() : undefined;
          }),
          adquirir: jest.fn(), liberar: jest.fn(),
        } },
        { provide: SchedulerRegistry,  useValue: { addCronJob: jest.fn(), deleteCronJob: jest.fn(), doesExist: jest.fn(() => false) } },
        { provide: EmpresaConfigService, useValue: { get: jest.fn(), obtener: jest.fn() } },
        { provide: 'PROVISIONAMIENTO_PROVIDER', useValue: {
          // El worker delega en el proveedor (patrón Estrategia) y ABORTA si devuelve
          // falsy: sin un valor por defecto, jest.fn() devuelve undefined y la
          // reactivación se rechaza siempre.
          reactivarServicio:   jest.fn().mockResolvedValue(true),
          suspenderServicio:   jest.fn().mockResolvedValue(true),
          provisionarServicio: jest.fn().mockResolvedValue(true),
        } },
          { provide: EventEmitter2,      useValue: mockEvents },
          { provide: getDataSourceToken(), useValue: { query: dsMock } },
        ],
      }).compile();
      const w = m.get<CobranzaWorker>(CobranzaWorker);

      await w.handleReactivarContrato(createMockJob({
        contratoId: 'cnt-001', empresaId: 'emp-001', clienteId: 'cli-001',
        routerId: 'rtr-001', ipAsignada: '192.168.1.2',
        planNombre: 'Plan 30 Mbps', notificar: true,
      }) as any);

      expect(mockFirewall.reactivarCliente).toHaveBeenCalledWith(
        expect.anything(), '192.168.1.2',
      );
      // Igual que en la suspensión: la notificación es un EVENTO de dominio, no una
      // llamada directa al gateway. Se comprueba que se emite con los datos del cliente.
      expect(mockEvents.emit).toHaveBeenCalledWith(
        expect.stringContaining('reactivado'),
        expect.objectContaining({ contratoId: 'cnt-001' }),
      );
    });
  });

  // ── Procesar pago ─────────────────────────────────────────
  describe('processPago()', () => {
    it('debe aplicar pago y calcular nueva deuda', async () => {
      const dsMock = jest.fn()
        .mockResolvedValueOnce([{ deuda: '0.00', meses: '0' }]) // deuda post-pago
        .mockResolvedValueOnce([])   // UPDATE contratos
        .mockResolvedValue([]);

      const m = await Test.createTestingModule({
        providers: [
          CobranzaWorker,
          { provide: FirewallService,    useValue: mockFirewall },
          { provide: PppoeService,       useValue: mockPppoe },
          { provide: FacturacionService, useValue: mockFacturacionSvc },
          { provide: AuditoriaService,   useValue: mockAuditoria },
        { provide: GatewayMensajeriaService, useValue: mockWhatsapp },
        { provide: OutboxRedService,   useValue: { encolar: jest.fn().mockResolvedValue(undefined), encolarDesprovisionar: jest.fn().mockResolvedValue(undefined), encolarOnu: jest.fn().mockResolvedValue(undefined) } },
        { provide: RedisLockService,   useValue: {
          // Firma real: withLock(clave, ttlMs, fn). Ejecutar el 2º argumento (el TTL)
          // hacía que el trabajo dentro del lock no corriera NUNCA y el test fallara
          // sin ninguna llamada al hardware.
          withLock: jest.fn(async (...args: any[]) => {
            const fn = args.find((a) => typeof a === 'function');
            return fn ? fn() : undefined;
          }),
          adquirir: jest.fn(), liberar: jest.fn(),
        } },
        { provide: SchedulerRegistry,  useValue: { addCronJob: jest.fn(), deleteCronJob: jest.fn(), doesExist: jest.fn(() => false) } },
        { provide: EmpresaConfigService, useValue: { get: jest.fn(), obtener: jest.fn() } },
        { provide: 'PROVISIONAMIENTO_PROVIDER', useValue: {
          // El worker delega en el proveedor (patrón Estrategia) y ABORTA si devuelve
          // falsy: sin un valor por defecto, jest.fn() devuelve undefined y la
          // reactivación se rechaza siempre.
          reactivarServicio:   jest.fn().mockResolvedValue(true),
          suspenderServicio:   jest.fn().mockResolvedValue(true),
          provisionarServicio: jest.fn().mockResolvedValue(true),
        } },
          { provide: EventEmitter2,      useValue: mockEvents },
          { provide: getDataSourceToken(), useValue: { query: dsMock } },
        ],
      }).compile();
      const w = m.get<CobranzaWorker>(CobranzaWorker);

      const result = await w.processPago(createMockJob({
        pagoId: 'pag-001', facturaId: 'fac-001',
        contratoId: 'cnt-001', empresaId: 'emp-001',
        montoPago: 85, fechaPago: '2024-01-20',
      }) as any);

      expect(mockFacturacionSvc.aplicarPago).toHaveBeenCalledWith(
        'fac-001', 85, 'emp-001', '2024-01-20',
      );
      expect(result.nuevaDeuda).toBe(0);
      expect(result.reactivar).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────
// FacturacionWorker Tests
// ─────────────────────────────────────────────────────────────
describe('FacturacionWorker', () => {
  let worker: FacturacionWorker;

  beforeEach(async () => {
    // Mock POR PATRÓN DE CONSULTA, no por orden de llamada.
    //
    // El encadenado de `mockResolvedValueOnce` ataba el test al número y orden exactos de
    // queries: al añadir dos lecturas nuevas (el IGV y la serie salieron de `empresas` y
    // pasaron a `configuracion_facturacion` / `comprobantes_config`, 2026-07-28) toda la
    // secuencia se desplazó y los tres tests fallaron sin que la lógica cambiara.
    // Responder por patrón hace el mock inmune al orden.
    const dsMock = jest.fn(async (sql: string) => {
      const s = String(sql);
      if (/FROM\s+empresas/i.test(s))                  return [mockEmpresa];
      if (/FROM\s+configuracion_facturacion/i.test(s)) return [{ igv_rate: '0.18' }];
      if (/FROM\s+comprobantes_config/i.test(s))       return [{ serie: 'B001' }];
      if (/FROM\s+contratos\b/i.test(s))               return [mockContratoFactura];
      // El correlativo se calcula con MAX(correlativo)+1 SOBRE `facturas`, así que esta
      // comprobación va ANTES del "sin duplicado": ambas consultan la misma tabla y la
      // primera regla que coincida gana.
      if (/AS\s+siguiente|nextval/i.test(s))           return [{ siguiente: '1' }];
      if (/FROM\s+facturas/i.test(s))                  return [];   // sin duplicado del periodo
      if (/INSERT\s+INTO\s+facturas/i.test(s))         return [{ id: 'fac-001', numero_completo: 'B001-00000001' }];
      return [];
    });

    const m: TestingModule = await Test.createTestingModule({
      providers: [
        FacturacionWorker,
        { provide: FacturacionService, useValue: mockFacturacionSvc },
        { provide: AuditoriaService,   useValue: mockAuditoria },
        { provide: GatewayMensajeriaService, useValue: mockWhatsapp },
        { provide: OutboxRedService,   useValue: { encolar: jest.fn().mockResolvedValue(undefined), encolarDesprovisionar: jest.fn().mockResolvedValue(undefined), encolarOnu: jest.fn().mockResolvedValue(undefined) } },
        { provide: RedisLockService,   useValue: {
          // Firma real: withLock(clave, ttlMs, fn). Ejecutar el 2º argumento (el TTL)
          // hacía que el trabajo dentro del lock no corriera NUNCA y el test fallara
          // sin ninguna llamada al hardware.
          withLock: jest.fn(async (...args: any[]) => {
            const fn = args.find((a) => typeof a === 'function');
            return fn ? fn() : undefined;
          }),
          adquirir: jest.fn(), liberar: jest.fn(),
        } },
        { provide: SchedulerRegistry,  useValue: { addCronJob: jest.fn(), deleteCronJob: jest.fn(), doesExist: jest.fn(() => false) } },
        { provide: EmpresaConfigService, useValue: { get: jest.fn(), obtener: jest.fn() } },
        { provide: 'PROVISIONAMIENTO_PROVIDER', useValue: {
          // El worker delega en el proveedor (patrón Estrategia) y ABORTA si devuelve
          // falsy: sin un valor por defecto, jest.fn() devuelve undefined y la
          // reactivación se rechaza siempre.
          reactivarServicio:   jest.fn().mockResolvedValue(true),
          suspenderServicio:   jest.fn().mockResolvedValue(true),
          provisionarServicio: jest.fn().mockResolvedValue(true),
        } },
        { provide: EventEmitter2,      useValue: mockEvents },
        { provide: getDataSourceToken(), useValue: { query: dsMock } },
      ],
    }).compile();
    worker = m.get<FacturacionWorker>(FacturacionWorker);
  });

  afterEach(() => jest.clearAllMocks());

  describe('processGenerarFacturasEmpresa()', () => {
    it('debe generar factura correctamente con IGV', async () => {
      const job = createMockJob({
        empresaId: 'emp-001', mes: 1, anio: 2024, forzar: false,
      });

      const result = await worker.processGenerarFacturasEmpresa(job as any);

      expect(result.exitosas).toBe(1);
      expect(result.errores).toBe(0);
      expect(result.montoTotal).toBeGreaterThan(0);
    });

    it('debe omitir contrato si ya fue facturado en el periodo', async () => {
      // Mismo mock por patrón que el resto, salvo que la comprobación de duplicado SÍ
      // encuentra una factura del periodo. Es la protección contra la doble facturación:
      // si el cron se ejecuta dos veces (reintento, dos instancias PM2), el cliente no
      // puede recibir dos facturas del mismo mes.
      const dsMockConDuplicado = jest.fn(async (sql: string) => {
        const s = String(sql);
        if (/FROM\s+empresas/i.test(s))                  return [mockEmpresa];
        if (/FROM\s+configuracion_facturacion/i.test(s)) return [{ igv_rate: '0.18' }];
        if (/FROM\s+comprobantes_config/i.test(s))       return [{ serie: 'B001' }];
        if (/FROM\s+contratos\b/i.test(s))               return [mockContratoFactura];
        if (/AS\s+siguiente|nextval/i.test(s))           return [{ siguiente: '1' }];
        if (/FROM\s+facturas/i.test(s))                  return [{ id: 'fac-existe' }];
        return [];
      });

      const m = await Test.createTestingModule({
        providers: [
          FacturacionWorker,
          { provide: FacturacionService, useValue: mockFacturacionSvc },
          { provide: AuditoriaService,   useValue: mockAuditoria },
        { provide: GatewayMensajeriaService, useValue: mockWhatsapp },
        { provide: OutboxRedService,   useValue: { encolar: jest.fn().mockResolvedValue(undefined), encolarDesprovisionar: jest.fn().mockResolvedValue(undefined), encolarOnu: jest.fn().mockResolvedValue(undefined) } },
        { provide: RedisLockService,   useValue: {
          // Firma real: withLock(clave, ttlMs, fn). Ejecutar el 2º argumento (el TTL)
          // hacía que el trabajo dentro del lock no corriera NUNCA y el test fallara
          // sin ninguna llamada al hardware.
          withLock: jest.fn(async (...args: any[]) => {
            const fn = args.find((a) => typeof a === 'function');
            return fn ? fn() : undefined;
          }),
          adquirir: jest.fn(), liberar: jest.fn(),
        } },
        { provide: SchedulerRegistry,  useValue: { addCronJob: jest.fn(), deleteCronJob: jest.fn(), doesExist: jest.fn(() => false) } },
        { provide: EmpresaConfigService, useValue: { get: jest.fn(), obtener: jest.fn() } },
        { provide: 'PROVISIONAMIENTO_PROVIDER', useValue: {
          // El worker delega en el proveedor (patrón Estrategia) y ABORTA si devuelve
          // falsy: sin un valor por defecto, jest.fn() devuelve undefined y la
          // reactivación se rechaza siempre.
          reactivarServicio:   jest.fn().mockResolvedValue(true),
          suspenderServicio:   jest.fn().mockResolvedValue(true),
          provisionarServicio: jest.fn().mockResolvedValue(true),
        } },
          { provide: EventEmitter2,      useValue: mockEvents },
          { provide: getDataSourceToken(), useValue: { query: dsMockConDuplicado } },
        ],
      }).compile();
      const w = m.get<FacturacionWorker>(FacturacionWorker);

      const result = await w.processGenerarFacturasEmpresa(
        createMockJob({ empresaId: 'emp-001', mes: 1, anio: 2024, forzar: false }) as any,
      );

      expect(result.omitidas).toBe(1);
      expect(result.exitosas).toBe(0);
    });

    it('emite el aviso de factura emitida (no llama al gateway directamente)', async () => {
      // Igual que cobranza: el worker EMITE `notification.factura.emitida` y quien
      // entrega el mensaje se suscribe. Facturar no puede quedar acoplado a que WhatsApp
      // esté disponible — una factura tiene que emitirse aunque no se pueda avisar.
      const job = createMockJob({ empresaId: 'emp-001', mes: 1, anio: 2024, forzar: false });
      await worker.processGenerarFacturasEmpresa(job as any);

      expect(mockEvents.emit).toHaveBeenCalledWith(
        'notification.factura.emitida',
        expect.anything(),
      );
    });

    it('debe emitir evento al completar generación', async () => {
      const job = createMockJob({ empresaId: 'emp-001', mes: 1, anio: 2024, forzar: false });
      await worker.processGenerarFacturasEmpresa(job as any);
      expect(mockEvents.emit).toHaveBeenCalledWith(
        'facturacion.generacion.completada',
        expect.objectContaining({ empresaId: 'emp-001', mes: 1, anio: 2024 }),
      );
    });
  });

  describe('processMarcarVencidas()', () => {
    it('debe marcar facturas vencidas en BD', async () => {
      const dsMock = jest.fn()
        .mockResolvedValueOnce(new Array(5).fill({ id: 'fac-x' })); // 5 vencidas

      const m = await Test.createTestingModule({
        providers: [
          FacturacionWorker,
          { provide: FacturacionService, useValue: mockFacturacionSvc },
          { provide: AuditoriaService,   useValue: mockAuditoria },
        { provide: GatewayMensajeriaService, useValue: mockWhatsapp },
        { provide: OutboxRedService,   useValue: { encolar: jest.fn().mockResolvedValue(undefined), encolarDesprovisionar: jest.fn().mockResolvedValue(undefined), encolarOnu: jest.fn().mockResolvedValue(undefined) } },
        { provide: RedisLockService,   useValue: {
          // Firma real: withLock(clave, ttlMs, fn). Ejecutar el 2º argumento (el TTL)
          // hacía que el trabajo dentro del lock no corriera NUNCA y el test fallara
          // sin ninguna llamada al hardware.
          withLock: jest.fn(async (...args: any[]) => {
            const fn = args.find((a) => typeof a === 'function');
            return fn ? fn() : undefined;
          }),
          adquirir: jest.fn(), liberar: jest.fn(),
        } },
        { provide: SchedulerRegistry,  useValue: { addCronJob: jest.fn(), deleteCronJob: jest.fn(), doesExist: jest.fn(() => false) } },
        { provide: EmpresaConfigService, useValue: { get: jest.fn(), obtener: jest.fn() } },
        { provide: 'PROVISIONAMIENTO_PROVIDER', useValue: {
          // El worker delega en el proveedor (patrón Estrategia) y ABORTA si devuelve
          // falsy: sin un valor por defecto, jest.fn() devuelve undefined y la
          // reactivación se rechaza siempre.
          reactivarServicio:   jest.fn().mockResolvedValue(true),
          suspenderServicio:   jest.fn().mockResolvedValue(true),
          provisionarServicio: jest.fn().mockResolvedValue(true),
        } },
          { provide: EventEmitter2,      useValue: mockEvents },
          { provide: getDataSourceToken(), useValue: { query: dsMock } },
        ],
      }).compile();
      const w = m.get<FacturacionWorker>(FacturacionWorker);

      const result = await w.processMarcarVencidas(
        createMockJob({ fecha: '2024-01-20' }) as any,
      );

      expect(result.marcadas).toBe(5);
      expect(mockEvents.emit).toHaveBeenCalledWith(
        'facturas.vencidas.marcadas', expect.objectContaining({ marcadas: 5 }),
      );
    });
  });
});
