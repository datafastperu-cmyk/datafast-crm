import { Test, TestingModule }   from '@nestjs/testing';
import { getDataSourceToken }     from '@nestjs/typeorm';
import { VelocidadService, EstrategiaQueue, CapacidadRouter } from './services/velocidad/velocidad.service';
import { MangleService }          from './services/velocidad/mangle.service';
import { QueueTreeClienteService } from './services/velocidad/queue-tree-cliente.service';
import { VelocidadOrquestador }   from './services/velocidad/velocidad-orquestador.service';
import { RouterConnectionPool }   from './services/connection-pool.service';
import { QueueService }           from './services/queue.service';

// ─── Mocks ────────────────────────────────────────────────────
const mockPool = {
  execute:    jest.fn(),
  acquire:    jest.fn(),
  release:    jest.fn(),
  invalidate: jest.fn(),
};

const mockMangleSvc = {
  crearMangleCliente:      jest.fn(),
  eliminarMangleCliente:   jest.fn(),
  actualizarIpMangle:      jest.fn(),
  setEstadoMangle:         jest.fn(),
  generarNombresMarcas:    jest.fn(),
  listarManglesFirebranet: jest.fn(),
};

const mockQtSvc = {
  crearQueueTreeCliente:     jest.fn(),
  actualizarVelocidad:       jest.fn(),
  eliminarQueueTreeCliente:  jest.fn(),
  generarNombres:            jest.fn(),
  listarQueueTreesFibranet:  jest.fn(),
};

const mockQueueSvc = {
  crearSimpleQueue:          jest.fn(),
  eliminarSimpleQueue:       jest.fn(),
  actualizarLimiteQueue:     jest.fn(),
  tienePcqConfigurado:       jest.fn(),
  configurarPcqCompleto:     jest.fn(),
  listarSimpleQueues:        jest.fn(),
};

const mockDs = {
  query: jest.fn().mockResolvedValue([]),
};

const mockCreds = {
  id: 'rtr-001', ip: '192.168.100.1', port: 8728,
  user: 'admin', passwordCifrado: 'pass', useSsl: false,
  timeoutSec: 10, version: 'v7',
};

const mockCapacidadCompleta: CapacidadRouter = {
  tieneSimpleQueue: true,
  tieneQueueTree:   true,
  tienePcq:         true,
  totalQueues:      50,
  sesionesActivas:  25,
  cpuLoad:          20,
  memoryUsePct:     40,
  versionRos:       '7.12',
};

const mockCapacidadSinPcq: CapacidadRouter = {
  ...mockCapacidadCompleta,
  tienePcq: false,
};

// ─────────────────────────────────────────────────────────────
// VelocidadService tests
// ─────────────────────────────────────────────────────────────
describe('VelocidadService', () => {
  let service: VelocidadService;

  beforeEach(async () => {
    const m = await Test.createTestingModule({
      providers: [
        VelocidadService,
        { provide: RouterConnectionPool, useValue: mockPool },
      ],
    }).compile();
    service = m.get<VelocidadService>(VelocidadService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── decidirEstrategia ─────────────────────────────────────
  describe('decidirEstrategia()', () => {
    it('debe retornar SIMPLE_QUEUE para planes residenciales', () => {
      const e = service.decidirEstrategia('simple_queue', mockCapacidadCompleta, 10);
      expect(e).toBe(EstrategiaQueue.SIMPLE_QUEUE);
    });

    it('debe retornar QUEUE_TREE cuando el plan lo requiere', () => {
      const e = service.decidirEstrategia('queue_tree', mockCapacidadCompleta, 10);
      expect(e).toBe(EstrategiaQueue.QUEUE_TREE);
    });

    it('debe retornar PCQ_GLOBAL cuando hay PCQ configurado', () => {
      const e = service.decidirEstrategia('pcq', mockCapacidadCompleta, 10);
      expect(e).toBe(EstrategiaQueue.PCQ_GLOBAL);
    });

    it('debe caer a QUEUE_TREE si pide PCQ pero no está configurado', () => {
      const e = service.decidirEstrategia('pcq', mockCapacidadSinPcq, 10);
      expect(e).toBe(EstrategiaQueue.QUEUE_TREE);
    });

    it('debe retornar SIN_LIMITE para planes dedicados', () => {
      const e = service.decidirEstrategia('sin_limite', mockCapacidadCompleta, 10);
      expect(e).toBe(EstrategiaQueue.SIN_LIMITE);
    });
  });

  // ── construirConfig ───────────────────────────────────────
  describe('construirConfig()', () => {
    it('debe asignar prioridad 1 a plan dedicado', () => {
      const c = service.construirConfig({
        nombreCliente: 'cli_abc', ipAsignada: '192.168.1.2',
        downloadMbps: 100, uploadMbps: 100,
        tipoPlan: 'dedicado', estrategia: EstrategiaQueue.QUEUE_TREE,
      });
      expect(c.prioridad).toBe(1);
    });

    it('debe asignar prioridad 5 a plan residencial', () => {
      const c = service.construirConfig({
        nombreCliente: 'cli_abc', ipAsignada: '192.168.1.2',
        downloadMbps: 30, uploadMbps: 15,
        tipoPlan: 'residencial', estrategia: EstrategiaQueue.SIMPLE_QUEUE,
      });
      expect(c.prioridad).toBe(5);
    });

    it('debe calcular burst threshold al 80% si hay burst', () => {
      const c = service.construirConfig({
        nombreCliente: 'cli', ipAsignada: '192.168.1.2',
        downloadMbps: 30, uploadMbps: 15,
        burstDownMbps: 60, burstUpMbps: 30,
        tipoPlan: 'residencial', estrategia: EstrategiaQueue.SIMPLE_QUEUE,
      });
      expect(c.burstThreshDown).toBe(24); // 30 * 0.8
      expect(c.burstThreshUp).toBe(12);   // 15 * 0.8
    });
  });

  // ── parseMikrotikRate ─────────────────────────────────────
  describe('parseMikrotikRate()', () => {
    it('parsea Mbps: 30M → 30', () => expect(service.parseMikrotikRate('30M')).toBe(30));
    it('parsea Kbps: 512K → 0.5', () => expect(service.parseMikrotikRate('512K')).toBeCloseTo(0.5));
    it('parsea Gbps: 1G → 1000', () => expect(service.parseMikrotikRate('1G')).toBe(1000));
  });
});

// ─────────────────────────────────────────────────────────────
// VelocidadOrquestador tests
// ─────────────────────────────────────────────────────────────
describe('VelocidadOrquestador', () => {
  let orquestador: VelocidadOrquestador;
  let velocidadSvc: VelocidadService;

  beforeEach(async () => {
    const m = await Test.createTestingModule({
      providers: [
        VelocidadOrquestador,
        { provide: RouterConnectionPool,      useValue: mockPool },
        { provide: VelocidadService,          useValue: {
          detectarCapacidad: jest.fn().mockResolvedValue(mockCapacidadCompleta),
          decidirEstrategia: jest.fn().mockReturnValue(EstrategiaQueue.SIMPLE_QUEUE),
          construirConfig:   jest.fn().mockReturnValue({
            estrategia: EstrategiaQueue.SIMPLE_QUEUE,
            downloadMbps: 30, uploadMbps: 15, prioridad: 5,
            nombreQueue: 'cli_abc', targetIp: '192.168.1.2',
          }),
          listarDiscrepancias: jest.fn().mockResolvedValue([]),
        }},
        { provide: MangleService,             useValue: mockMangleSvc },
        { provide: QueueTreeClienteService,   useValue: mockQtSvc },
        { provide: QueueService,              useValue: mockQueueSvc },
        { provide: getDataSourceToken(),      useValue: mockDs },
      ],
    }).compile();
    orquestador  = m.get<VelocidadOrquestador>(VelocidadOrquestador);
    velocidadSvc = m.get<VelocidadService>(VelocidadService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── aplicarVelocidad ──────────────────────────────────────
  describe('aplicarVelocidad()', () => {
    const baseParams = {
      routerCreds: mockCreds, clienteId: 'cli-001',
      usuarioPppoe: 'cli_abc', ipAsignada: '192.168.1.2',
      downloadMbps: 30, uploadMbps: 15,
      tipoQueuePlan: 'simple_queue', tipoPlan: 'residencial',
    };

    it('debe aplicar Simple Queue y retornar exitoso', async () => {
      mockQueueSvc.crearSimpleQueue.mockResolvedValue('*1');

      const r = await orquestador.aplicarVelocidad(baseParams as any);

      expect(r.exitoso).toBe(true);
      expect(r.estrategia).toBe(EstrategiaQueue.SIMPLE_QUEUE);
      expect(mockQueueSvc.crearSimpleQueue).toHaveBeenCalled();
    });

    it('debe aplicar Queue Tree cuando la estrategia lo indica', async () => {
      (velocidadSvc.decidirEstrategia as jest.Mock).mockReturnValue(EstrategiaQueue.QUEUE_TREE);
      mockQtSvc.crearQueueTreeCliente.mockResolvedValue({
        nombres: { padre: 'fn-qt-001', download: 'fn-qt-001-down', upload: 'fn-qt-001-up' },
        reglasCreadas: 6,
      });

      const r = await orquestador.aplicarVelocidad({ ...baseParams as any, tipoQueuePlan: 'queue_tree' });

      expect(r.estrategia).toBe(EstrategiaQueue.QUEUE_TREE);
      expect(r.reglasCreadas).toBe(6);
    });

    it('debe retornar exitoso para plan SIN_LIMITE sin crear queues', async () => {
      (velocidadSvc.decidirEstrategia as jest.Mock).mockReturnValue(EstrategiaQueue.SIN_LIMITE);

      const r = await orquestador.aplicarVelocidad({ ...baseParams as any, tipoQueuePlan: 'sin_limite' });

      expect(r.estrategia).toBe(EstrategiaQueue.SIN_LIMITE);
      expect(r.reglasCreadas).toBe(0);
      expect(mockQueueSvc.crearSimpleQueue).not.toHaveBeenCalled();
    });

    it('debe retornar exitoso=false y no lanzar excepción ante error de conexión', async () => {
      mockQueueSvc.crearSimpleQueue.mockRejectedValue(new Error('Connection timeout'));

      const r = await orquestador.aplicarVelocidad(baseParams as any);

      expect(r.exitoso).toBe(false);
      expect(r.detalle).toContain('Connection timeout');
    });
  });

  // ── cambiarVelocidadPlan ──────────────────────────────────
  describe('cambiarVelocidadPlan()', () => {
    it('actualiza por Queue Tree si existe', async () => {
      mockQtSvc.actualizarVelocidad.mockResolvedValue({ actualizado: true, metodo: 'queue_tree' });

      const r = await orquestador.cambiarVelocidadPlan(mockCreds, 'cli-001', 'cli_abc', 50, 25);

      expect(r.actualizado).toBe(true);
      expect(r.metodo).toBe('queue_tree');
    });

    it('cae a Simple Queue si no hay Queue Tree', async () => {
      mockQtSvc.actualizarVelocidad.mockResolvedValue({ actualizado: false, metodo: 'no_encontrado' });
      mockQueueSvc.actualizarLimiteQueue.mockResolvedValue(undefined);

      const r = await orquestador.cambiarVelocidadPlan(mockCreds, 'cli-001', 'cli_abc', 50, 25);

      expect(r.actualizado).toBe(true);
      expect(r.metodo).toBe('simple_queue');
    });

    it('retorna no_encontrado si no hay ninguna queue', async () => {
      mockQtSvc.actualizarVelocidad.mockResolvedValue({ actualizado: false, metodo: 'no_encontrado' });
      mockQueueSvc.actualizarLimiteQueue.mockRejectedValue(new Error('Queue not found'));

      const r = await orquestador.cambiarVelocidadPlan(mockCreds, 'cli-001', 'cli_abc', 50, 25);

      expect(r.actualizado).toBe(false);
      expect(r.metodo).toBe('no_encontrado');
    });
  });

  // ── eliminarVelocidadCliente ──────────────────────────────
  describe('eliminarVelocidadCliente()', () => {
    it('debe intentar eliminar tanto Queue Tree como Simple Queue', async () => {
      mockQtSvc.eliminarQueueTreeCliente.mockResolvedValue(undefined);
      mockQueueSvc.eliminarSimpleQueue.mockResolvedValue(undefined);

      await orquestador.eliminarVelocidadCliente(mockCreds, 'cli-001', 'cli_abc');

      expect(mockQtSvc.eliminarQueueTreeCliente).toHaveBeenCalledWith(mockCreds, 'cli-001');
      expect(mockQueueSvc.eliminarSimpleQueue).toHaveBeenCalledWith(mockCreds, 'cli_abc');
    });

    it('no debe lanzar excepción si las queues no existen', async () => {
      mockQtSvc.eliminarQueueTreeCliente.mockRejectedValue(new Error('not found'));
      mockQueueSvc.eliminarSimpleQueue.mockRejectedValue(new Error('not found'));

      await expect(
        orquestador.eliminarVelocidadCliente(mockCreds, 'cli-001', 'cli_abc'),
      ).resolves.not.toThrow();
    });
  });
});

// ─────────────────────────────────────────────────────────────
// MangleService tests (naming generation)
// ─────────────────────────────────────────────────────────────
describe('MangleService - generarNombresMarcas', () => {
  let service: MangleService;

  beforeEach(async () => {
    const m = await Test.createTestingModule({
      providers: [
        MangleService,
        { provide: RouterConnectionPool, useValue: mockPool },
      ],
    }).compile();
    service = m.get<MangleService>(MangleService);
  });

  it('debe generar nombres únicos y cortos para un clienteId', () => {
    const marcas = service.generarNombresMarcas('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(marcas.connMarkDown.length).toBeLessThanOrEqual(20);
    expect(marcas.connMarkDown).toContain('fn-');
    expect(marcas.connMarkUp).not.toBe(marcas.connMarkDown);
    expect(marcas.packetMarkDown).not.toBe(marcas.packetMarkUp);
  });

  it('debe generar nombres diferentes para clientes distintos', () => {
    const m1 = service.generarNombresMarcas('aaa00000-0000-0000-0000-000000000001');
    const m2 = service.generarNombresMarcas('bbb00000-0000-0000-0000-000000000002');
    expect(m1.connMarkDown).not.toBe(m2.connMarkDown);
  });
});
