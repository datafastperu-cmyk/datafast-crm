import { Test, TestingModule }     from '@nestjs/testing';
import { getRepositoryToken }        from '@nestjs/typeorm';
import { getDataSourceToken }        from '@nestjs/typeorm';
import { EventEmitter }             from '@nestjs/event-emitter';
import { NotFoundException, ConflictException } from '@nestjs/common';

import { MikrotikService }           from './mikrotik.service';
import { RouterConnectionPool }      from './services/connection-pool.service';
import { PppoeService }              from './services/pppoe.service';
import { QueueService }              from './services/queue.service';
import { FirewallService }           from './services/firewall.service';
import { InterfaceService }          from './services/interface.service';
import { AuditoriaService }          from '../auth/auditoria.service';
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

const mockPppoe = {
  crear:                jest.fn().mockResolvedValue('*1'),
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
};

const mockQueue = {
  crearSimpleQueue:         jest.fn().mockResolvedValue('*2'),
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
  configurarReglasControl: jest.fn(),
  crearDhcpBinding:        jest.fn(),
  eliminarDhcpBinding:     jest.fn(),
  listarDhcpLeases:        jest.fn(),
  listarServidoresDhcp:    jest.fn(),
};

const mockIface = {
  getRecursos:        jest.fn(),
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
        { provide: EventEmitter,              useValue: mockEvents },
        { provide: getDataSourceToken(),       useValue: mockDs },
      ],
    }).compile();
    service = m.get<MikrotikService>(MikrotikService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── Crear router ───────────────────────────────────────────
  describe('crearRouter()', () => {
    it('debe crear un router y cifrar el password', async () => {
      mockRepo.findOne.mockResolvedValue(null); // no existe
      mockRepo.save.mockResolvedValue(mockRouter);

      const dto = {
        nombre: 'Router Sur', ipGestion: '192.168.200.1',
        usuario: 'admin', password: 'secret123',
      };
      const result = await service.crearRouter(dto as any, mockUser as any);
      expect(result.id).toBeDefined();
      expect(mockRepo.save).toHaveBeenCalled();
    });

    it('debe lanzar ConflictException si la IP ya existe', async () => {
      mockRepo.findOne.mockResolvedValue(mockRouter);
      await expect(
        service.crearRouter({ ipGestion: '192.168.100.1' } as any, mockUser as any),
      ).rejects.toThrow(ConflictException);
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
      mockPppoe.crear.mockResolvedValue('*1');
      mockQueue.crearSimpleQueue.mockResolvedValue('*2');
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
      mockPppoe.crear.mockResolvedValue('*1');
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
      mockFirewall.suspenderCliente.mockResolvedValue(undefined);
      mockPppoe.desconectarSesion.mockResolvedValue(undefined);
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
      mockFirewall.reactivarCliente.mockResolvedValue(undefined);
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
      mockIface.getIdentity.mockResolvedValue('Router-Principal');
      mockRepo.update.mockResolvedValue(undefined);

      const result = await service.getEstadoRouter('rtr-001', 'emp-001');

      expect(result.recursos.cpuLoad).toBe(15);
      expect(result.interfaces).toHaveLength(1);
      expect(result.sesionesActivas).toBe(2);
    });
  });
});
