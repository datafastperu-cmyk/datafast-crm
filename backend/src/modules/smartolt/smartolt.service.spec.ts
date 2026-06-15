import { Test, TestingModule }    from '@nestjs/testing';
import { getDataSourceToken }      from '@nestjs/typeorm';
import { EventEmitter }           from '@nestjs/event-emitter';
import {
  NotFoundException, ConflictException, BadRequestException,
} from '@nestjs/common';

import { SmartoltService }         from './smartolt.service';
import { SmartoltApiService }      from './smartolt-api.service';
import { OnuRepository }           from './repositories/onu.repository';
import { OrquestadorFtthService }  from './orquestador-ftth.service';
import { MikrotikService }         from '../mikrotik/mikrotik.service';
import { PppoeService }            from '../mikrotik/services/pppoe.service';
import { VelocidadOrquestador }    from '../mikrotik/services/velocidad/velocidad-orquestador.service';
import { FirewallService }         from '../mikrotik/services/firewall.service';
import { AuditoriaService }        from '../auth/auditoria.service';
import { Olt, Onu, EstadoOnu }    from './entities/onu.entity';

// ── Fixtures ──────────────────────────────────────────────────
const mockUser = {
  sub: 'usr-001', email: 'tecnico@test.pe',
  empresaId: 'emp-001', roles: ['Técnico'],
  permisos: ['onu:provision'], nombreCompleto: 'Técnico', tema: 'dark',
};

const mockOlt: Partial<Olt> = {
  id: 'olt-001', empresaId: 'emp-001',
  nombre: 'OLT Centro', smartoltId: 'smart-olt-001',
  ipGestion: '10.0.0.1', activo: true, deletedAt: null,
};

const mockOnu: Partial<Onu> = {
  id: 'onu-001', empresaId: 'emp-001',
  oltId: 'olt-001', serialNumber: '48575443ABCD1234',
  ponPort: '0/1/3', perfilSmartolt: 'HSI-100M',
  vlanId: 100, estado: EstadoOnu.APROVISIONADA,
  smartoltOnuId: 'smart-onu-001',
  deletedAt: null, createdAt: new Date(),
};

const mockOnuNoAprovisionada = {
  serial: '48575443ABCD1234', pon_port: '0/1/3',
  pon_type: 'GPON', olt_id: 'smart-olt-001',
};

const mockOnuSmartolt = {
  id: 'smart-onu-001', serial: '48575443ABCD1234',
  pon_port: '0/1/3', status: 'offline',
  profile: 'HSI-100M', vlan: 100, olt_id: 'smart-olt-001',
};

// ── Mocks ─────────────────────────────────────────────────────
const mockApi = {
  listarOlts:                jest.fn(),
  getOlt:                    jest.fn(),
  listarOnusDeOlt:           jest.fn(),
  getOnu:                    jest.fn(),
  getOnuBySerial:            jest.fn(),
  listarOnusNoAprovisionadas: jest.fn(),
  detectarOnuEnPuerto:       jest.fn(),
  aprovisionarOnu:           jest.fn(),
  eliminarProvision:         jest.fn(),
  getSeñalOnu:               jest.fn(),
  reiniciarOnu:              jest.fn(),
  listarPerfiles:            jest.fn(),
  verificarConectividad:     jest.fn(),
  actualizarOnu:             jest.fn(),
  getEstadisticasOlt:        jest.fn(),
  eliminarProvisionPorSerial: jest.fn(),
};

const mockOnuRepo = {
  create:                jest.fn(d => ({ ...mockOnu, ...d })),
  save:                  jest.fn(async o => ({ ...mockOnu, ...o })),
  update:                jest.fn(),
  findById:              jest.fn(),
  findBySerial:          jest.fn(),
  findByContratoId:      jest.fn(),
  findAllPaginated:      jest.fn(),
  findByOlt:             jest.fn(),
  findSinAprovisionar:   jest.fn(),
  softDelete:            jest.fn(),
  getResumen:            jest.fn(),
  findCompletaPorId:     jest.fn(),
  findAllOlts:           jest.fn(),
  findOltById:           jest.fn(),
  saveOlt:               jest.fn(async d => ({ ...mockOlt, ...d })),
  updateOlt:             jest.fn(),
};

const mockAuditoria = {
  log: jest.fn(), logCreate: jest.fn(), logDelete: jest.fn(),
};

const mockDs = { query: jest.fn() };
const mockEvents = { emit: jest.fn() };

const mockMikrotikSvc = { findOne: jest.fn() };
const mockPppoeSvc    = { crear: jest.fn().mockResolvedValue('*1') };
const mockVelocidadOrc = { aplicarVelocidad: jest.fn().mockResolvedValue({ exitoso: true, estrategia: 'simple_queue', reglasCreadas: 1, detalle: 'ok' }) };
const mockFirewallSvc  = { configurarReglasControl: jest.fn() };

// ─── Tests SmartoltService ────────────────────────────────────
describe('SmartoltService', () => {
  let service: SmartoltService;

  beforeEach(async () => {
    const m = await Test.createTestingModule({
      providers: [
        SmartoltService,
        { provide: SmartoltApiService, useValue: mockApi },
        { provide: OnuRepository,      useValue: mockOnuRepo },
        { provide: AuditoriaService,   useValue: mockAuditoria },
        { provide: getDataSourceToken(), useValue: mockDs },
      ],
    }).compile();
    service = m.get<SmartoltService>(SmartoltService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── Aprovisionar ONU ──────────────────────────────────────
  describe('aprovisionarOnu()', () => {
    const dto = {
      oltId: 'olt-001', serialNumber: '48575443ABCD1234',
      ponPort: '0/1/3', perfil: 'HSI-100M', vlanId: 100,
    };

    it('debe aprovisionar ONU nueva correctamente', async () => {
      mockOnuRepo.findOltById.mockResolvedValue(mockOlt);
      mockOnuRepo.findBySerial.mockResolvedValue(null);     // no existe
      mockApi.aprovisionarOnu.mockResolvedValue(mockOnuSmartolt);
      mockOnuRepo.save.mockResolvedValue(mockOnu);
      mockDs.query.mockResolvedValue([{ id: 'cnt-001' }]);

      const result = await service.aprovisionarOnu(dto as any, mockUser as any);

      expect(mockApi.aprovisionarOnu).toHaveBeenCalledWith(expect.objectContaining({
        serial:   '48575443ABCD1234',
        pon_port: '0/1/3',
        vlan:     100,
      }));
      expect(result.estado).toBe(EstadoOnu.APROVISIONADA);
    });

    it('debe lanzar ConflictException si ONU ya está aprovisionada', async () => {
      mockOnuRepo.findOltById.mockResolvedValue(mockOlt);
      mockOnuRepo.findBySerial.mockResolvedValue({ ...mockOnu, estado: EstadoOnu.ONLINE });

      await expect(
        service.aprovisionarOnu(dto as any, mockUser as any),
      ).rejects.toThrow(ConflictException);
    });

    it('debe lanzar BadRequestException si OLT no tiene smartoltId', async () => {
      mockOnuRepo.findOltById.mockResolvedValue({ ...mockOlt, smartoltId: null });
      mockOnuRepo.findBySerial.mockResolvedValue(null);

      await expect(
        service.aprovisionarOnu(dto as any, mockUser as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── Eliminar provisión ────────────────────────────────────
  describe('eliminarProvision()', () => {
    it('debe eliminar en SmartOLT y actualizar BD', async () => {
      mockOnuRepo.findById.mockResolvedValue(mockOnu);
      mockOnuRepo.findOltById.mockResolvedValue(mockOlt);
      mockApi.eliminarProvision.mockResolvedValue(undefined);
      mockDs.query.mockResolvedValue([]);
      mockOnuRepo.update.mockResolvedValue(undefined);

      await service.eliminarProvision('onu-001', mockUser as any);

      expect(mockApi.eliminarProvision).toHaveBeenCalledWith('smart-olt-001', 'smart-onu-001');
      expect(mockOnuRepo.update).toHaveBeenCalledWith('onu-001', expect.objectContaining({
        estado: EstadoOnu.SIN_APROVISIONAR,
      }));
    });

    it('debe lanzar BadRequestException si ONU no tiene smartoltOnuId', async () => {
      mockOnuRepo.findById.mockResolvedValue({ ...mockOnu, smartoltOnuId: null });
      mockOnuRepo.findOltById.mockResolvedValue(mockOlt);

      await expect(
        service.eliminarProvision('onu-001', mockUser as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── Sincronizar estado ────────────────────────────────────
  describe('sincronizarEstadoOnus()', () => {
    it('debe actualizar estado online/offline de ONUs', async () => {
      mockOnuRepo.findOltById.mockResolvedValue(mockOlt);
      mockApi.listarOnusDeOlt.mockResolvedValue([
        { serial: '48575443ABCD1234', status: 'online', rx_power: -18.5 },
        { serial: 'DDCCBBAA00001234', status: 'offline' },
      ]);
      mockOnuRepo.findBySerial
        .mockResolvedValueOnce(mockOnu)    // primera ONU encontrada
        .mockResolvedValueOnce(null);       // segunda no registrada
      mockOnuRepo.update.mockResolvedValue(undefined);
      mockOnuRepo.updateOlt.mockResolvedValue(undefined);

      const r = await service.sincronizarEstadoOnus('emp-001', 'olt-001');

      expect(r.actualizadas).toBe(1);
      expect(r.online).toBe(1);
      expect(r.offline).toBe(0);
    });
  });
});

// ─── Tests OrquestadorFtthService ─────────────────────────────
describe('OrquestadorFtthService - ejecutarFlujoComipletoFtth', () => {
  let orquestador: OrquestadorFtthService;

  const mockContratoRow = {
    id: 'cnt-001', numero_contrato: 'CNT-2024-000001',
    estado: 'pendiente_activacion', aprovisionado: false,
    usuario_pppoe: 'cli_abc12345', password_pppoe: 'pass123',
    ip_asignada: '192.168.1.2',
    cliente_nombre: 'Juan Pérez', telefono: '987654321', email: 'juan@test.pe',
    plan_nombre: 'Plan 30 Mbps', velocidad_bajada: 30, velocidad_subida: 15,
    tipo_queue: 'simple_queue', ppp_profile: 'default', tipo_plan: 'residencial',
    burst_bajada: null, burst_subida: null, burst_tiempo: 8,
    router_id: 'rtr-001', router_ip: '192.168.100.1',
    version_ros: 'v7', router_user: 'admin', router_pass: 'encryptedpass',
    usar_ssl: false, puerto_api: 8728, puerto_api_ssl: 8729, timeout_conexion: 10,
  };

  beforeEach(async () => {
    const m = await Test.createTestingModule({
      providers: [
        OrquestadorFtthService,
        { provide: SmartoltService,       useValue: {
          findOneOlt:     jest.fn().mockResolvedValue(mockOlt),
          aprovisionarOnu: jest.fn().mockResolvedValue(mockOnu),
          asociarAContrato: jest.fn().mockResolvedValue(undefined),
        }},
        { provide: SmartoltApiService,    useValue: mockApi },
        { provide: MikrotikService,       useValue: mockMikrotikSvc },
        { provide: PppoeService,          useValue: mockPppoeSvc },
        { provide: VelocidadOrquestador,  useValue: mockVelocidadOrc },
        { provide: FirewallService,       useValue: mockFirewallSvc },
        { provide: AuditoriaService,      useValue: mockAuditoria },
        { provide: EventEmitter,         useValue: mockEvents },
        { provide: getDataSourceToken(),  useValue: mockDs },
      ],
    }).compile();
    orquestador = m.get<OrquestadorFtthService>(OrquestadorFtthService);
  });

  afterEach(() => jest.clearAllMocks());

  it('debe completar los 8 pasos con éxito', async () => {
    // Paso 1: contrato válido
    mockDs.query
      .mockResolvedValueOnce([mockContratoRow])  // validar contrato
      .mockResolvedValueOnce([{ fn_next_available_ip: null }])  // no necesita IP (ya tiene)
      // Paso 5: asociar contrato
      .mockResolvedValueOnce([{ id: 'cnt-001', onu_id: null }])
      // Paso 8: actualizar contrato + historial
      .mockResolvedValue([]);

    mockApi.detectarOnuEnPuerto.mockResolvedValue(mockOnuNoAprovisionada);

    const dto: FlujoComipletoFtthDto = {
      contratoId: 'cnt-001', clienteId: 'cli-001',
      oltId: 'olt-001', ponPort: '0/1/3',
      perfil: 'HSI-100M', vlanId: 100,
      routerId: 'rtr-001', segmentoId: 'seg-001',
      notificarCliente: false,
    } as any;

    const result = await orquestador.ejecutarFlujoComipletoFtth(dto, mockUser as any);

    expect(result.exitoso).toBe(true);
    expect(result.pasos).toHaveLength(8);
    expect(result.pasos.every(p => p.estado === 'ok')).toBe(true);
  });

  it('debe interrumpir el flujo y marcar pasos restantes como omitidos si falla', async () => {
    // Paso 1 falla — contrato no encontrado
    mockDs.query.mockResolvedValueOnce([]);

    const dto = {
      contratoId: 'cnt-no-existe', clienteId: 'cli-001',
      oltId: 'olt-001', ponPort: '0/1/3',
      perfil: 'HSI-100M', vlanId: 100, routerId: 'rtr-001',
    } as any;

    const result = await orquestador.ejecutarFlujoComipletoFtth(dto, mockUser as any);

    expect(result.exitoso).toBe(false);
    expect(result.pasos[0].estado).toBe('error');
    // Los pasos 2-8 deben estar omitidos
    expect(result.pasos.slice(1).every(p => p.estado === 'omitido')).toBe(true);
    expect(result.mensajeFinal).toContain('paso 1');
  });

  it('debe usar el SN detectado automáticamente si no se proporciona', async () => {
    mockDs.query
      .mockResolvedValueOnce([mockContratoRow])
      .mockResolvedValueOnce([{ fn_next_available_ip: null }])
      .mockResolvedValueOnce([{ id: 'cnt-001', onu_id: null }])
      .mockResolvedValue([]);

    // ONU detectada automáticamente
    mockApi.detectarOnuEnPuerto.mockResolvedValue(mockOnuNoAprovisionada);

    const dto = {
      contratoId: 'cnt-001', clienteId: 'cli-001',
      oltId: 'olt-001', ponPort: '0/1/3',
      perfil: 'HSI-100M', vlanId: 100, routerId: 'rtr-001',
      // serialNumber NO se provee
    } as any;

    const result = await orquestador.ejecutarFlujoComipletoFtth(dto, mockUser as any);

    // Paso 3 debería indicar que detectó automáticamente
    const paso3 = result.pasos.find(p => p.paso === 3);
    expect(paso3?.detalle).toContain('48575443ABCD1234');
  });
});
