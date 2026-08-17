import { Test, TestingModule }     from '@nestjs/testing';
import { getRepositoryToken }        from '@nestjs/typeorm';
import { getDataSourceToken }        from '@nestjs/typeorm';
import { EventEmitter2 }            from '@nestjs/event-emitter';
import { NotFoundException, ConflictException } from '@nestjs/common';

import { MikrotikService }           from './mikrotik.service';
import { RouterConnectionPool }      from './services/connection-pool.service';
import { PppoeService }              from './services/pppoe.service';
import { QueueService }              from './services/queue.service';
import { FirewallService }           from './services/firewall.service';
import { InterfaceService }          from './services/interface.service';
import { AuditoriaService }          from '../auth/auditoria.service';
import { ArpService }                from './services/arp.service';
import { SubnetRouteService }        from './services/subnet-route.service';
import { VpnClienteService }         from '../openvpn/services/vpn-cliente.service';
import { ModuleHealthService }       from '../../common/services/module-health.service';
import { EmpresaConfigService }      from '../config/empresa-config.service';
import { SchedulerRegistry }         from '@nestjs/schedule';
import { Router, EstadoEquipo, VersionRouterOS, MetodoConexion } from './entities/router.entity';

// ── Fixtures ──────────────────────────────────────────────────
const mockUser = {
  sub: 'usr-001', email: 'admin@test.pe',
  empresaId: 'emp-001', roles: ['Administrador'],
  permisos: [], nombreCompleto: 'Admin', tema: 'dark',
};

const mockRouter: Partial<Router> = {
  id:              'rtr-001',
  empresaId:       'emp-001',
  nombre:          'Router Principal',
  ipGestion:       '192.168.100.1',
  puertoApi:       8728,
  puertoApiSsl:    8729,
  usuario:         'admin',
  passwordCifrado: 'password123',
  versionRos:      VersionRouterOS.V7,
  metodoConexion:  MetodoConexion.API,
  usarSsl:         false,
  timeoutConexion: 10,
  estado:          EstadoEquipo.DESCONOCIDO,
  activo:          true,
  deletedAt:       null,
};

// ── Mock del RouterOS API ──────────────────────────────────────
const mockApi = {
  write:   jest.fn(),
  connect: jest.fn(),
  close:   jest.fn(),
};

const mockRepo = {
  create:   jest.fn(d => ({ ...mockRouter, ...d })),
  save:     jest.fn(async r => ({ ...mockRouter, ...r })),
  findOne:  jest.fn(),
  find:     jest.fn(),
  update:   jest.fn(),
};

const mockPool = {
  execute:      jest.fn(),
  acquire:      jest.fn(),
  release:      jest.fn(),
  invalidate:   jest.fn(),
  connectDirect: jest.fn(),
};

// Ola 1, grupo 3b (2026-08-17): FirewallService/PppoeService/QueueService hablan
// ResultadoOperacion — RO_APLICADO es el valor por defecto neutro para los mocks que no
// declaran un escenario de fallo explícito.
const RO_APLICADO = { clase: 'aplicado' as const, mensaje: 'ok' };
const mockPppoe = {
  crear:                jest.fn().mockResolvedValue(RO_APLICADO),
  eliminar:             jest.fn(),
  setEstado:            jest.fn(),
  desconectarSesion:    jest.fn(),
  cambiarPassword:      jest.fn(),
  listarSecrets:        jest.fn(),
  listarSesionesActivas: jest.fn(),
  getSesion:            jest.fn(),
  listarPerfiles:       jest.fn(),
  crearPerfilSiNoExiste: jest.fn(),
  getTraficoSesion:     jest.fn(),
  contarSesionesActivas: jest.fn().mockResolvedValue(0),
};

const mockQueue = {
  crearSimpleQueue:         jest.fn().mockResolvedValue(RO_APLICADO),
  eliminarSimpleQueue:      jest.fn(),
  tienePcqConfigurado:      jest.fn().mockResolvedValue(true),
  configurarPcqCompleto:    jest.fn(),
  actualizarLimiteQueue:    jest.fn(),
  listarSimpleQueues:       jest.fn(),
  getEstadisticasQueue:     jest.fn(),
};

const mockFirewall = {
  suspenderCliente:        jest.fn(),
  reactivarCliente:        jest.fn(),
  estaEnListaMorosos:      jest.fn(),
  listarMorosos:           jest.fn(),
  aplicarProrroga:         jest.fn(),
  configurarReglasControl: jest.fn().mockResolvedValue(undefined),
  crearDhcpBinding:        jest.fn(),
  eliminarDhcpBinding:     jest.fn(),
  listarDhcpLeases:        jest.fn(),
  listarServidoresDhcp:    jest.fn(),
};

const mockIface = {
  // Con `jest.fn()` a secas devuelve undefined, y `detectarVersionAsync` encadena un
  // `.then()` sobre el resultado: revienta en una tarea de fondo que nada tiene que ver
  // con lo que el test comprueba. Un mock sin valor por defecto no es neutro.
  getRecursos:        jest.fn().mockResolvedValue({ version: '7.14', cpuLoad: 0 }),
  getIdentity:        jest.fn().mockResolvedValue('MikroTik'),
  listarInterfaces:   jest.fn(),
  monitorearInterface: jest.fn(),
  listarIps:          jest.fn(),
  getArp:             jest.fn(),
  listarRutas:        jest.fn(),
  getLog:             jest.fn(),
  detectarVersion:    jest.fn().mockResolvedValue('v7'),
  ping:               jest.fn(),
};

const mockAuditoria = { log: jest.fn(), logCreate: jest.fn() };
const mockEvents    = { emit: jest.fn() };
const mockDs        = { query: jest.fn() };

// ─── Tests ────────────────────────────────────────────────────
describe('MikrotikService', () => {
  let service: MikrotikService;

  beforeEach(async () => {
    const m: TestingModule = await Test.createTestingModule({
      providers: [
        MikrotikService,
        { provide: getRepositoryToken(Router), useValue: mockRepo },
        { provide: RouterConnectionPool,       useValue: mockPool },
        { provide: PppoeService,               useValue: mockPppoe },
        { provide: QueueService,               useValue: mockQueue },
        { provide: FirewallService,            useValue: mockFirewall },
        { provide: InterfaceService,           useValue: mockIface },
        { provide: AuditoriaService,           useValue: mockAuditoria },
        { provide: EventEmitter2,             useValue: mockEvents },
        { provide: getDataSourceToken(),       useValue: mockDs },
        // Dependencias que MikrotikService adquirió después de escribirse este spec.
        // Faltando una sola, Nest no instancia el servicio y la suite ENTERA se cae —
        // no un test suelto. Son dobles inertes: aquí no se prueba su comportamiento.
        { provide: ArpService,          useValue: { listar: jest.fn(), crear: jest.fn(), eliminar: jest.fn() } },
        // `fetchSubnets` se dispara en segundo plano tras crear el router (descubre las
        // redes que cuelgan de él). Devuelve promesa: sin ella el `.then()` revienta.
        { provide: SubnetRouteService,  useValue: {
          listar: jest.fn(), sincronizar: jest.fn(),
          fetchSubnets: jest.fn().mockResolvedValue([]),
          guardarSubnets: jest.fn().mockResolvedValue(undefined),
        } },
        // Todos devuelven promesa: el alta encadena `.catch()` sobre ellos como tareas de
        // fondo (generar el CCD del cert VPN). Un `jest.fn()` pelado devuelve undefined y
        // el encadenado revienta lejos del código que se está probando.
        { provide: VpnClienteService,   useValue: {
          revocar: jest.fn().mockResolvedValue(undefined),
          listar:  jest.fn().mockResolvedValue([]),
          generarParaRouter: jest.fn().mockResolvedValue(undefined),
        } },
        { provide: ModuleHealthService, useValue: { registrar: jest.fn() } },
        { provide: SchedulerRegistry,   useValue: { addInterval: jest.fn(), deleteInterval: jest.fn(), doesExist: jest.fn(() => false) } },
        { provide: EmpresaConfigService, useValue: { get: jest.fn(), obtener: jest.fn() } },
      ],
    }).compile();
    service = m.get<MikrotikService>(MikrotikService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── Crear router ───────────────────────────────────────────
  describe('crearRouter()', () => {
    it('debe crear un router y cifrar el password', async () => {
      // `findOne` se usa dos veces con propósitos distintos: validar que la IP no esté
      // repetida (busca por `ipGestion` → null) y releer el router recién creado (busca
      // por `id` → el router). Se discrimina por la consulta en vez de por el orden de
      // llamada: un `mockResolvedValueOnce` sin consumir se filtra al test siguiente.
      // El alta valida unicidad de IP de gestión, NOMBRE e IP VPN antes de crear; las
      // tres deben devolver null. Solo la relectura final (por `id`) devuelve el router.
      mockRepo.findOne.mockImplementation(async (opts: any) => {
        const w = opts?.where ?? {};
        if (w.ipGestion || w.nombre || w.vpnIp) return null;   // validaciones de unicidad
        return mockRouter;                                      // relectura por id
      });
      mockRepo.save.mockResolvedValue(mockRouter);

      const dto = {
        nombre: 'Router Sur', ipGestion: '192.168.200.1',
        usuario: 'admin', password: 'secret123',
      };
      const result = await service.crearRouter(dto as any, mockUser as any);
      expect(result.id).toBeDefined();
      expect(mockRepo.save).toHaveBeenCalled();
    });

    it('rechaza una IP de gestión ya registrada en la empresa', async () => {
      // Un router duplicado por IP es lo que llenó la tabla de fantasmas que el ERP
      // seguía poleando (incidente 2026-07-28: 11 registros para 5 IPs). El servicio
      // lanza BadRequestException, no ConflictException — el test seguía esperando la
      // excepción antigua y por eso no protegía nada.
      mockRepo.findOne.mockImplementation(async () => mockRouter);
      await expect(
        service.crearRouter({ ipGestion: '192.168.100.1' } as any, mockUser as any),
      ).rejects.toThrow(/ya está registrada/i);
    });
  });

  // ── findOne ────────────────────────────────────────────────
  describe('findOne()', () => {
    it('retorna el router si existe', async () => {
      mockRepo.findOne.mockResolvedValue(mockRouter);
      const r = await service.findOne('rtr-001', 'emp-001');
      expect(r.ipGestion).toBe('192.168.100.1');
    });

    it('lanza NotFoundException si no existe', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('no-existe', 'emp-001')).rejects.toThrow(NotFoundException);
    });
  });

  // ── Provisionar cliente ────────────────────────────────────
  describe('provisionarCliente()', () => {
    it('debe crear PPPoE + SimpleQueue', async () => {
      mockRepo.findOne.mockResolvedValue(mockRouter);
      mockPppoe.crear.mockResolvedValue(RO_APLICADO);
      mockQueue.crearSimpleQueue.mockResolvedValue(RO_APLICADO);
      mockFirewall.configurarReglasControl.mockResolvedValue(undefined);

      const dto = {
        clienteId: 'cli-001', usuarioPppoe: 'cli_abc',
        passwordPppoe: 'pass123', ipAsignada: '192.168.1.2',
        downloadMbps: 30, uploadMbps: 15, tipoQueue: 'simple_queue',
      };

      const result = await service.provisionarCliente('rtr-001', dto as any, mockUser as any);

      expect(mockPppoe.crear).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: 'cli_abc', remoteAddress: '192.168.1.2' }),
      );
      expect(mockQueue.crearSimpleQueue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ maxLimitDown: 30, maxLimitUp: 15 }),
      );
      expect(result).toHaveProperty('ppppoeId');
    });

    it('con PCQ: si no está configurado debe configurarlo primero', async () => {
      mockRepo.findOne.mockResolvedValue(mockRouter);
      mockQueue.tienePcqConfigurado.mockResolvedValue(false);
      mockQueue.configurarPcqCompleto.mockResolvedValue(undefined);
      mockPppoe.crear.mockResolvedValue(RO_APLICADO);
      mockFirewall.configurarReglasControl.mockResolvedValue(undefined);

      const dto = {
        clienteId: 'cli-001', usuarioPppoe: 'cli_abc',
        passwordPppoe: 'pass', ipAsignada: '192.168.1.3',
        downloadMbps: 30, uploadMbps: 15, tipoQueue: 'pcq',
      };

      await service.provisionarCliente('rtr-001', dto as any, mockUser as any);
      expect(mockQueue.configurarPcqCompleto).toHaveBeenCalled();
    });
  });

  // ── Suspender cliente ─────────────────────────────────────
  describe('suspenderCliente()', () => {
    it('debe agregar IP a Address List y desconectar sesión PPPoE', async () => {
      mockRepo.findOne.mockResolvedValue(mockRouter);
      // Ola 1, grupo 3b: FirewallService/PppoeService hablan ResultadoOperacion.
      mockFirewall.suspenderCliente.mockResolvedValue({ clase: 'aplicado', mensaje: 'ok' });
      mockPppoe.desconectarSesion.mockResolvedValue({ clase: 'aplicado', mensaje: 'ok' });
      mockEvents.emit.mockReturnValue(true);

      await service.suspenderCliente(
        'rtr-001',
        { clienteId: 'cli-001', ipAsignada: '192.168.1.2', usuarioPppoe: 'cli_abc', motivo: 'mora' },
        mockUser as any,
      );

      expect(mockFirewall.suspenderCliente).toHaveBeenCalledWith(
        expect.anything(), '192.168.1.2', 'cli-001', expect.any(String),
      );
      expect(mockPppoe.desconectarSesion).toHaveBeenCalledWith(
        expect.anything(), 'cli_abc',
      );
      expect(mockEvents.emit).toHaveBeenCalledWith(
        'mikrotik.cliente.suspendido',
        expect.objectContaining({ clienteId: 'cli-001' }),
      );
    });
  });

  // ── Reactivar cliente ─────────────────────────────────────
  describe('reactivarCliente()', () => {
    it('debe quitar IP de Address Lists y emitir evento', async () => {
      mockRepo.findOne.mockResolvedValue(mockRouter);
      // Ola 1, grupo 3b: reactivarCliente() habla ResultadoOperacion.
      mockFirewall.reactivarCliente.mockResolvedValue({ clase: 'aplicado', mensaje: 'ok' });
      mockEvents.emit.mockReturnValue(true);

      await service.reactivarCliente(
        'rtr-001',
        { clienteId: 'cli-001', ipAsignada: '192.168.1.2' },
        mockUser as any,
      );

      expect(mockFirewall.reactivarCliente).toHaveBeenCalledWith(
        expect.anything(), '192.168.1.2',
      );
      expect(mockEvents.emit).toHaveBeenCalledWith(
        'mikrotik.cliente.reactivado',
        expect.objectContaining({ clienteId: 'cli-001' }),
      );
    });
  });

  // ── Test conexión ─────────────────────────────────────────
  describe('testConexion()', () => {
    it('debe reportar éxito cuando la conexión funciona', async () => {
      mockRepo.findOne.mockResolvedValue(mockRouter);
      mockPool.invalidate.mockResolvedValue(undefined);
      mockIface.getIdentity.mockResolvedValue('Router-ISP');
      mockRepo.update.mockResolvedValue(undefined);

      const result = await service.testConexion('rtr-001', 'emp-001');
      expect(result.exitoso).toBe(true);
      expect(result.mensaje).toContain('Router-ISP');
    });

    it('debe reportar fallo cuando no puede conectar', async () => {
      mockRepo.findOne.mockResolvedValue(mockRouter);
      mockPool.invalidate.mockResolvedValue(undefined);
      mockIface.getIdentity.mockRejectedValue(new Error('Connection refused'));
      mockRepo.update.mockResolvedValue(undefined);

      const result = await service.testConexion('rtr-001', 'emp-001');
      expect(result.exitoso).toBe(false);
      expect(result.mensaje).toContain('Connection refused');
    });
  });

  // ── Estado del router ─────────────────────────────────────
  describe('getEstadoRouter()', () => {
    it('debe retornar recursos, interfaces y sesiones', async () => {
      mockRepo.findOne.mockResolvedValue(mockRouter);
      mockIface.getRecursos.mockResolvedValue({
        version: '7.12', cpuLoad: 15, freeMemory: 50_000_000,
        totalMemory: 256_000_000, uptime: '3d4h', uptimeSeconds: 360000,
        boardName: 'CCR1036', platform: 'MikroTik', buildTime: '',
        freeHdd: 0, totalHdd: 0,
      });
      mockIface.listarInterfaces.mockResolvedValue([
        { name: 'ether1', running: true, rxRate: 1_000_000, txRate: 500_000 },
      ]);
      mockPppoe.listarSesionesActivas.mockResolvedValue([
        { name: 'cli_001', address: '192.168.1.2' },
        { name: 'cli_002', address: '192.168.1.3' },
      ]);
      // El conteo pasó a resolverse con `contarSesionesActivas` en vez de traer todas
      // las sesiones y medir el array: en un router con miles de sesiones, listarlas
      // solo para contarlas es caro.
      mockPppoe.contarSesionesActivas.mockResolvedValue(2);
      mockIface.getIdentity.mockResolvedValue('Router-Principal');
      mockRepo.update.mockResolvedValue(undefined);

      const result = await service.getEstadoRouter('rtr-001', 'emp-001');

      expect(result.recursos.cpuLoad).toBe(15);
      expect(result.interfaces).toHaveLength(1);
      expect(result.sesionesActivas).toBe(2);
    });
  });
});
