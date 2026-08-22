import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken }  from '@nestjs/typeorm';
import { EventEmitter2 }       from '@nestjs/event-emitter';
import { getQueueToken }       from '@nestjs/bull';
import { CACHE_MANAGER }       from '@nestjs/cache-manager';

import { CobranzaWorker, CobranzaScheduler } from './cobranza.worker';
import { FacturacionWorker }   from './facturacion.worker';
import { FirewallService }     from '../mikrotik/services/firewall.service';
import { PppoeService }        from '../mikrotik/services/pppoe.service';
import { FacturacionService }  from '../facturacion/facturacion.service';
import { DeudaPorContratoService } from '../facturacion/deuda-por-contrato.service';
import { ComprobantesConfigService } from '../facturacion/comprobantes-config.service';
import { AuditoriaService }    from '../auth/auditoria.service';
import { OutboxRedService } from '../outbox-red/outbox-red.service';
import { RedisLockService } from '../../common/redis/redis-lock.service';
import { SchedulerRegistry } from '@nestjs/schedule';
import { EmpresaConfigService } from '../config/empresa-config.service';
import { GatewayMensajeriaService } from '../notificaciones/services/gateway-mensajeria.service';
import { PoliticaFacturacionService } from '../facturacion/politica-facturacion.service';
import { QUEUES, JOBS }        from './workers.constants';

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
// Ola 1, grupo 3b (2026-08-17): FirewallService/PppoeService hablan ResultadoOperacion.
const RO_APLICADO = { clase: 'aplicado' as const, mensaje: 'ok' };
const mockFirewall = {
  suspenderCliente:        jest.fn().mockResolvedValue(RO_APLICADO),
  reactivarCliente:        jest.fn().mockResolvedValue(RO_APLICADO),
  configurarReglasControl: jest.fn().mockResolvedValue(undefined),
};

const mockPppoe = {
  desconectarSesion: jest.fn().mockResolvedValue(RO_APLICADO),
  crear:             jest.fn().mockResolvedValue(RO_APLICADO),
  // Suspender ya no es solo desconectar la sesión: además DESHABILITA el secret
  // (`setEstado(creds, usuario, true)`). Sin esto el cliente se reconectaba al instante
  // — desconectar sin deshabilitar no suspende a nadie.
  setEstado:         jest.fn().mockResolvedValue(RO_APLICADO),
  eliminar:          jest.fn().mockResolvedValue(RO_APLICADO),
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
    // El orden importa: son `mockResolvedValueOnce` encadenados, así que una consulta
    // nueva en el worker desplaza todas las siguientes. La cascada al cliente (2026-08-04)
    // se coló justo antes del SELECT del cliente y dejó la notificación sin nombre.
    m.mockResolvedValueOnce([mockRouter])       // getRouter
      .mockResolvedValueOnce([])                // UPDATE servicios (suspender)
      .mockResolvedValueOnce([])                // INSERT servicios_historial
      .mockResolvedValueOnce([])                // UPDATE clientes (cascada) → ninguno bloqueado
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
        { provide: DeudaPorContratoService, useValue: { recalcularPorCliente: jest.fn().mockResolvedValue(undefined), calcular: jest.fn().mockResolvedValue(new Map()) } },
        { provide: ComprobantesConfigService, useValue: { resolverParaCliente: jest.fn().mockResolvedValue({ id: 'cc-1', codigo: 'ci', nombre: 'Comprobante Interno', serie: 'CI', tieneCargaFiscal: false }) } },
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
        { provide: DeudaPorContratoService, useValue: { recalcularPorCliente: jest.fn().mockResolvedValue(undefined), calcular: jest.fn().mockResolvedValue(new Map()) } },
        { provide: ComprobantesConfigService, useValue: { resolverParaCliente: jest.fn().mockResolvedValue({ id: 'cc-1', codigo: 'ci', nombre: 'Comprobante Interno', serie: 'CI', tieneCargaFiscal: false }) } },
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
        .mockResolvedValueOnce([mockRouter])   // getRouter
        .mockResolvedValueOnce([])             // UPDATE servicios (suspender)
        .mockResolvedValueOnce([])             // INSERT servicios_historial
        .mockResolvedValueOnce([])             // UPDATE clientes (cascada) → ninguno
        .mockResolvedValueOnce([mockCliente])  // getCliente para WhatsApp
        .mockResolvedValue([]);

      const m = await Test.createTestingModule({
        providers: [
          CobranzaWorker,
          { provide: FirewallService,    useValue: mockFirewall },
          { provide: PppoeService,       useValue: mockPppoe },
          { provide: FacturacionService, useValue: mockFacturacionSvc },
        { provide: DeudaPorContratoService, useValue: { recalcularPorCliente: jest.fn().mockResolvedValue(undefined), calcular: jest.fn().mockResolvedValue(new Map()) } },
        { provide: ComprobantesConfigService, useValue: { resolverParaCliente: jest.fn().mockResolvedValue({ id: 'cc-1', codigo: 'ci', nombre: 'Comprobante Interno', serie: 'CI', tieneCargaFiscal: false }) } },
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
        { provide: DeudaPorContratoService, useValue: { recalcularPorCliente: jest.fn().mockResolvedValue(undefined), calcular: jest.fn().mockResolvedValue(new Map()) } },
        { provide: ComprobantesConfigService, useValue: { resolverParaCliente: jest.fn().mockResolvedValue({ id: 'cc-1', codigo: 'ci', nombre: 'Comprobante Interno', serie: 'CI', tieneCargaFiscal: false }) } },
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
  //
  // Aquí se ejercitaba `processPago`, el job PROCESAR_PAGO. Se eliminó en F3 (2026-08-06)
  // junto con el job: era un SEGUNDO aplicador de dinero que nadie encolaba, y el campo
  // `fecha_ultimo_pago` que solo él mantenía hizo que se cortara a un abonado al día
  // siguiente de pagar (05/08). El test se retira con el código que probaba; lo que
  // impide que vuelva es `frontera-dinero.spec.ts`, que falla si reaparece la
  // declaración del job.
});

// ─────────────────────────────────────────────────────────────
// CobranzaScheduler.detectarMorosos() — Ola 4: deuda_total se retiró, la fuente ahora es
// DeudaPorContratoService.calcular(). El riesgo real de esa reescritura no era sintáctico
// era que un EXISTS a nivel de CONTRATO cortaría a un servicio con reparto proporcional en
// 0, cuando `deuda_total` no lo hacía. Este bloque prueba justo eso: dos servicios del
// mismo cliente, solo uno con deuda imputada, y que `calcular()` se llama una vez por
// CLIENTE, no una vez por fila.
// ─────────────────────────────────────────────────────────────
describe('CobranzaScheduler.detectarMorosos() — el reparto proporcional sobrevive al retiro de deuda_total', () => {
  let scheduler: CobranzaScheduler;
  let mockQueue: { add: jest.Mock };
  let mockDs: { query: jest.Mock };
  let mockCalcular: jest.Mock;

  // impagas: un solo cliente, con un comprobante vencido hace 10 días — por encima de
  // cualquier `diasGracia` razonable, para que la única variable en juego sea la deuda.
  const filaServicioA = {
    contrato_id: 'srv-a', empresa_id: 'emp-1', cliente_id: 'cli-x',
    router_id: 'rtr-1', ip_asignada: '10.0.0.1', usuario_pppoe: 'cli_a',
    facturacion_config: {}, dias_gracia_empresa: '5',
    vencimiento_del_ultimo: '2026-08-08', comprobantes_vencidos: 1,
    dias_vencido: 10, nombre_cliente: 'Cliente X',
  };
  const filaServicioB = { ...filaServicioA, contrato_id: 'srv-b', usuario_pppoe: 'cli_b' };

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 18, 0, 0, 0)); // 18/08, 00:00 local

    mockQueue = { add: jest.fn().mockResolvedValue(undefined) };
    mockDs = { query: jest.fn().mockResolvedValue([filaServicioA, filaServicioB]) };
    // Solo `srv-a` tiene deuda imputada — `srv-b` es el caso que un EXISTS a nivel de
    // contrato habría cortado igual, y que el reparto proporcional real no corta.
    mockCalcular = jest.fn().mockResolvedValue(new Map([
      ['srv-a', { monto: 50, comprobantes: 1 }],
      ['srv-b', { monto: 0,  comprobantes: 0 }],
    ]));

    const cacheGet = jest.fn((key: string) =>
      Promise.resolve(key.startsWith('cron:horario:') ? '00:00' : undefined),
    );

    const m: TestingModule = await Test.createTestingModule({
      providers: [
        CobranzaScheduler,
        { provide: getQueueToken(QUEUES.COBRANZA), useValue: mockQueue },
        { provide: getDataSourceToken(), useValue: mockDs },
        { provide: CACHE_MANAGER, useValue: { get: cacheGet, set: jest.fn().mockResolvedValue(undefined) } },
        { provide: SchedulerRegistry, useValue: { addCronJob: jest.fn(), deleteCronJob: jest.fn(), doesExist: jest.fn(() => false) } },
        { provide: EmpresaConfigService, useValue: { getTimezone: jest.fn().mockResolvedValue('America/Lima') } },
        { provide: PoliticaFacturacionService, useValue: {} },
        { provide: DeudaPorContratoService, useValue: { calcular: mockCalcular } },
      ],
    }).compile();
    scheduler = m.get<CobranzaScheduler>(CobranzaScheduler);
  });

  afterEach(() => { jest.useRealTimers(); jest.clearAllMocks(); });

  it('suspende el servicio con deuda imputada real y deja en paz al que reparte en 0', async () => {
    await scheduler.detectarMorosos();

    expect(mockQueue.add).toHaveBeenCalledTimes(1);
    expect(mockQueue.add).toHaveBeenCalledWith(
      JOBS.SUSPENDER_CONTRATO,
      expect.objectContaining({ contratoId: 'srv-a', deudaTotal: 50, mesesDeuda: 1 }),
      expect.anything(),
    );
  });

  it('calcula el reparto UNA vez por cliente, no una vez por servicio candidato', async () => {
    await scheduler.detectarMorosos();

    // Dos filas candidatas, mismo cliente — un cálculo por fila habría llamado
    // DeudaPorContratoService.calcular() dos veces con exactamente los mismos argumentos.
    expect(mockCalcular).toHaveBeenCalledTimes(1);
    expect(mockCalcular).toHaveBeenCalledWith('cli-x', 'emp-1');
  });
});

// ─────────────────────────────────────────────────────────────
// CobranzaScheduler.notificacionesPreventivas() — mismo riesgo, mismo arreglo que
// detectarMorosos(): el servicio con reparto proporcional en 0 no debe recibir el aviso de
// cobro previo, aunque el cliente sí tenga deuda en conjunto.
// ─────────────────────────────────────────────────────────────
describe('CobranzaScheduler.notificacionesPreventivas() — el reparto proporcional sobrevive al retiro de deuda_total', () => {
  let scheduler: CobranzaScheduler;
  let mockQueue: { add: jest.Mock };
  let mockDs: { query: jest.Mock };
  let mockCalcular: jest.Mock;

  // Sin `notificaciones_config` propia: cae en la rama "sin configuración propia"
  // (dias_contrato vs. dias_restantes, ambos en 3 → toca el aviso).
  const filaServicioA = {
    contrato_id: 'srv-a', empresa_id: 'emp-2', cliente_id: 'cli-y',
    dias_contrato: 3, nombre_completo: 'Cliente Y',
    whatsapp: '999999999', telefono: null,
    notificaciones_config: null, facturacion_config: null,
    vencimiento: '2026-08-21', dias_restantes: 3,
  };
  const filaServicioB = { ...filaServicioA, contrato_id: 'srv-b' };

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 18, 0, 0, 0)); // 18/08, 00:00 local

    mockQueue = { add: jest.fn().mockResolvedValue(undefined) };
    mockDs = { query: jest.fn().mockResolvedValue([filaServicioA, filaServicioB]) };
    // Solo `srv-a` tiene deuda imputada — `srv-b` es el caso que un EXISTS a nivel de
    // contrato habría notificado igual, y que el reparto proporcional real no notifica.
    mockCalcular = jest.fn().mockResolvedValue(new Map([
      ['srv-a', { monto: 30, comprobantes: 1 }],
      ['srv-b', { monto: 0,  comprobantes: 0 }],
    ]));

    const cacheGet = jest.fn((key: string) =>
      Promise.resolve(key.startsWith('cron:horario:') ? '00:00' : undefined),
    );

    const m: TestingModule = await Test.createTestingModule({
      providers: [
        CobranzaScheduler,
        { provide: getQueueToken(QUEUES.COBRANZA), useValue: mockQueue },
        { provide: getDataSourceToken(), useValue: mockDs },
        { provide: CACHE_MANAGER, useValue: { get: cacheGet, set: jest.fn().mockResolvedValue(undefined) } },
        { provide: SchedulerRegistry, useValue: { addCronJob: jest.fn(), deleteCronJob: jest.fn(), doesExist: jest.fn(() => false) } },
        { provide: EmpresaConfigService, useValue: { getTimezone: jest.fn().mockResolvedValue('America/Lima') } },
        { provide: PoliticaFacturacionService, useValue: {
          notificacionesDesde: jest.fn().mockReturnValue({ recordatoriosPago: null, recordatorios: [] }),
        } },
        { provide: DeudaPorContratoService, useValue: { calcular: mockCalcular } },
      ],
    }).compile();
    scheduler = m.get<CobranzaScheduler>(CobranzaScheduler);
  });

  afterEach(() => { jest.useRealTimers(); jest.clearAllMocks(); });

  it('notifica al servicio con deuda imputada real y deja en paz al que reparte en 0', async () => {
    await scheduler.notificacionesPreventivas();

    expect(mockQueue.add).toHaveBeenCalledTimes(1);
    expect(mockQueue.add).toHaveBeenCalledWith(
      JOBS.NOTIF_COBRO_PREVIO,
      expect.objectContaining({ contratoId: 'srv-a', montoDeuda: 30 }),
      expect.anything(),
    );
  });

  it('calcula el reparto UNA vez por cliente, no una vez por servicio candidato', async () => {
    await scheduler.notificacionesPreventivas();

    expect(mockCalcular).toHaveBeenCalledTimes(1);
    expect(mockCalcular).toHaveBeenCalledWith('cli-y', 'emp-2');
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
      if (/FROM\s+servicios\b/i.test(s))               return [mockContratoFactura];
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
        { provide: DeudaPorContratoService, useValue: { recalcularPorCliente: jest.fn().mockResolvedValue(undefined), calcular: jest.fn().mockResolvedValue(new Map()) } },
        { provide: ComprobantesConfigService, useValue: { resolverParaCliente: jest.fn().mockResolvedValue({ id: 'cc-1', codigo: 'ci', nombre: 'Comprobante Interno', serie: 'CI', tieneCargaFiscal: false }) } },
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

  describe('processGenerarFacturasEmpresa() — H-10: delega, no interpreta', () => {
    // Este job tenia ~320 lineas con SQL propio, su propio criterio de elegibilidad
    // (`estado = activo`, sin dias entregados), su propio periodo (mes de calendario) y su
    // propia idempotencia. Era la SEGUNDA autoridad sobre la misma decision de negocio.
    //
    // Habia divergido dos veces —el tipo de comprobante el 04/08 y todo el bloque del dinero
    // el 08-09/08— y estuvo a punto de emitir un comprobante duplicado el 1 de septiembre.
    // Los tests que vivian aqui comprobaban SU calculo del IGV, SU idempotencia y SUS eventos:
    // sostenian la duplicidad en vez de delatarla.
    //
    // Lo que queda por comprobar es lo unico que debe ser cierto: que llama a la autoridad.

    it('delega en FacturacionService en vez de generar por su cuenta', async () => {
      const job = createMockJob({ empresaId: 108, mes: 1, anio: 2024 });

      await worker.processGenerarFacturasEmpresa(job as any);

      expect(mockFacturacionSvc.generarMensual).toHaveBeenCalledWith(
        { mes: 1, anio: 2024 },
        expect.objectContaining({ sub: 'sistema' }),
      );
    });

    it('no traslada `forzar`: saltarse la idempotencia era una regla propia del worker', async () => {
      // Darle una puerta para esquivar la comprobacion de la autoridad seria devolverle una
      // regla propia por la puerta de atras.
      const job = createMockJob({ empresaId: 108, mes: 1, anio: 2024, forzar: true });

      await worker.processGenerarFacturasEmpresa(job as any);

      const dto = mockFacturacionSvc.generarMensual.mock.calls.at(-1)[0];
      expect(dto).not.toHaveProperty('forzar');
    });

    it('devuelve el resultado de la autoridad, no uno calculado aqui', async () => {
      const job = createMockJob({ empresaId: 108, mes: 1, anio: 2024 });

      const result = await worker.processGenerarFacturasEmpresa(job as any);

      expect(result.exitosas).toBe(1);
      expect(result.mes).toBe(1);
      expect(result.anio).toBe(2024);
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
        { provide: DeudaPorContratoService, useValue: { recalcularPorCliente: jest.fn().mockResolvedValue(undefined), calcular: jest.fn().mockResolvedValue(new Map()) } },
        { provide: ComprobantesConfigService, useValue: { resolverParaCliente: jest.fn().mockResolvedValue({ id: 'cc-1', codigo: 'ci', nombre: 'Comprobante Interno', serie: 'CI', tieneCargaFiscal: false }) } },
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
