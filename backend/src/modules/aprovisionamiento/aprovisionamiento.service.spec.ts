import { Test, TestingModule }   from '@nestjs/testing';
import { getDataSourceToken }     from '@nestjs/typeorm';
import { EventEmitter }          from '@nestjs/event-emitter';

import { OrquestadorAprovisionamientoService } from './aprovisionamiento.service';
import { PppoeService }           from '../mikrotik/services/pppoe.service';
import { QueueService }           from '../mikrotik/services/queue.service';
import { FirewallService }        from '../mikrotik/services/firewall.service';
import { VelocidadOrquestador }   from '../mikrotik/services/velocidad/velocidad-orquestador.service';
import { SmartoltApiService }     from '../smartolt/smartolt-api.service';
import { WhatsAppService }        from '../notificaciones/services/whatsapp.service';
import { EstrategiaQueue }        from '../mikrotik/services/velocidad/velocidad.service';

// ── Fixtures ──────────────────────────────────────────────────
const mockUser = {
  sub: 'usr-001', email: 'tecnico@test.pe',
  empresaId: 'emp-001', roles: ['Técnico'],
  permisos: ['onu:provision'], nombreCompleto: 'Técnico', tema: 'dark',
};

const mockContratoRow = {
  contrato_id: 'cnt-001', numero_contrato: 'CNT-2024-000001',
  contrato_estado: 'pendiente_instalacion', aprovisionado: false,
  usuario_pppoe: 'cli_abc12345', password_pppoe: 'pass123',
  ip_asignada: null,   // Sin IP asignada — se asignará del pool
  segmento_id: 'seg-001',
  cliente_id: 'cli-001', cliente_nombre: 'Juan Pérez',
  cliente_telefono: '987654321', cliente_email: 'juan@test.pe',
  cliente_whatsapp: null,
  plan_nombre: 'Plan 30 Mbps', velocidad_bajada: 30, velocidad_subida: 15,
  burst_bajada: null, burst_subida: null, burst_tiempo: 8,
  tipo_queue: 'simple_queue', ppp_profile: 'default', plan_tipo: 'residencial',
  plan_precio: 85,
  router_id: 'rtr-001', router_ip: '192.168.100.1',
  version_ros: 'v7', router_usuario: 'admin', router_pass: 'encryptedpass',
  usar_ssl: false, puerto_api: 8728, puerto_api_ssl: 8729,
  timeout_conexion: 10, auto_configurar_queues: true,
  olt_id: 'olt-001', smartolt_id: 'smart-olt-001', olt_nombre: 'OLT Centro',
  empresa_nombre: 'CRM ISP DATAFAST', serie_boleta: 'B001',
  igv_rate: 0.18, dias_gracia: 5,
};

const mockSegmento = {
  red_cidr: '192.168.1.0/24',
  gateway: '192.168.1.1',
  ips_reservadas: ['192.168.1.1'],
};

const mockOnuNoAprovisionada = {
  serial: '48575443ABCD1234',
  pon_port: '0/1/3',
  pon_type: 'GPON',
  olt_id: 'smart-olt-001',
};

const mockOnuSmartolt = {
  id: 'smart-onu-001',
  serial: '48575443ABCD1234',
  status: 'offline',
  profile: 'HSI-100M',
};

// ── Mocks ─────────────────────────────────────────────────────
const mockPppoeSvc = {
  crear:   jest.fn().mockResolvedValue('*1'),
  eliminar: jest.fn().mockResolvedValue(undefined),
};

const mockQueueSvc = {
  crearSimpleQueue:      jest.fn().mockResolvedValue('*2'),
  eliminarSimpleQueue:   jest.fn().mockResolvedValue(undefined),
  tienePcqConfigurado:   jest.fn().mockResolvedValue(true),
  actualizarLimiteQueue: jest.fn().mockResolvedValue(undefined),
};

const mockFirewallSvc = {
  configurarReglasControl: jest.fn().mockResolvedValue(undefined),
};

const mockVelocidadOrc = {
  aplicarVelocidad: jest.fn().mockResolvedValue({
    exitoso: true, estrategia: EstrategiaQueue.SIMPLE_QUEUE,
    reglasCreadas: 1, detalle: 'Queue simple creada',
  }),
};

const mockSmartoltApi = {
  detectarOnuEnPuerto: jest.fn().mockResolvedValue(mockOnuNoAprovisionada),
  aprovisionarOnu:     jest.fn().mockResolvedValue(mockOnuSmartolt),
  eliminarProvision:   jest.fn().mockResolvedValue(undefined),
};

const mockWhatsapp = {
  notificarBienvenida:       jest.fn().mockResolvedValue({ enviado: true, messageId: 'msg-001' }),
  notificarServicioActivado: jest.fn().mockResolvedValue({ enviado: true }),
  enviar:                    jest.fn().mockResolvedValue({ enviado: true }),
};

const mockEvents = { emit: jest.fn() };

// Secuencia de respuestas del DataSource para los 8 pasos
function buildDsQueryMock() {
  const mock = jest.fn();
  mock
    // Paso 1: validar contrato
    .mockResolvedValueOnce([mockContratoRow])
    // Paso 2: segmento IPv4
    .mockResolvedValueOnce([mockSegmento])
    // Paso 2: IPs en uso
    .mockResolvedValueOnce([{ ip_address: '192.168.1.1' }])
    // Paso 2: IP no ocupada (ipManual check) - no se usa en este test
    // Paso 2: INSERT ips_asignadas
    .mockResolvedValueOnce([])
    // Paso 2: UPDATE contratos.ip_asignada
    .mockResolvedValueOnce([])
    // Paso 7: INSERT onus
    .mockResolvedValueOnce([{ id: 'onu-001' }])
    // Paso 7: UPDATE contratos onu_id
    .mockResolvedValueOnce([])
    // Paso 8: UPDATE contratos estado
    .mockResolvedValueOnce([])
    // Paso 8: INSERT contratos_historial
    .mockResolvedValueOnce([])
    // Resto
    .mockResolvedValue([]);
  return mock;
}

// ─── Tests ────────────────────────────────────────────────────
describe('OrquestadorAprovisionamientoService', () => {
  let service: OrquestadorAprovisionamientoService;

  beforeEach(async () => {
    const m: TestingModule = await Test.createTestingModule({
      providers: [
        OrquestadorAprovisionamientoService,
        { provide: PppoeService,          useValue: mockPppoeSvc },
        { provide: QueueService,          useValue: mockQueueSvc },
        { provide: FirewallService,       useValue: mockFirewallSvc },
        { provide: VelocidadOrquestador,  useValue: mockVelocidadOrc },
        { provide: SmartoltApiService,    useValue: mockSmartoltApi },
        { provide: WhatsAppService,       useValue: mockWhatsapp },
        { provide: EventEmitter,         useValue: mockEvents },
        { provide: getDataSourceToken(),  useValue: { query: buildDsQueryMock() } },
      ],
    }).compile();

    service = m.get<OrquestadorAprovisionamientoService>(OrquestadorAprovisionamientoService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── Flujo exitoso completo ────────────────────────────────
  describe('ejecutar() — flujo exitoso', () => {
    const dto: AprovisionarFtthDto = {
      contratoId:     'cnt-001',
      clienteId:      'cli-001',
      oltId:          'olt-001',
      ponPort:        '0/1/3',
      perfilSmartolt: 'HSI-100M',
      vlanId:         100,
      routerId:       'rtr-001',
      segmentoId:     'seg-001',
      notificarWhatsApp: true,
      rollbackEnError:   true,
    } as any;

    it('debe completar los 8 pasos y retornar exitoso=true', async () => {
      const result = await service.ejecutar(dto, mockUser as any);

      expect(result.exitoso).toBe(true);
      expect(result.pasos).toHaveLength(8);
      expect(result.pasos.every((p) => p.estado === 'ok')).toBe(true);
      expect(result.rollbackEjecutado).toBe(false);
    });

    it('debe asignar la próxima IP del pool cuando el contrato no tiene IP', async () => {
      const result = await service.ejecutar(dto, mockUser as any);
      // 192.168.1.2 es la siguiente después del gateway 192.168.1.1
      expect(result.ipAsignada).toBe('192.168.1.2');
    });

    it('debe crear usuario PPPoE con la IP asignada', async () => {
      await service.ejecutar(dto, mockUser as any);

      expect(mockPppoeSvc.crear).toHaveBeenCalledWith(
        expect.objectContaining({ ip: '192.168.100.1' }),
        expect.objectContaining({
          name:          'cli_abc12345',
          remoteAddress: '192.168.1.2',
        }),
      );
    });

    it('debe aplicar control de velocidad según el plan', async () => {
      await service.ejecutar(dto, mockUser as any);

      expect(mockVelocidadOrc.aplicarVelocidad).toHaveBeenCalledWith(
        expect.objectContaining({
          downloadMbps:  30,
          uploadMbps:    15,
          tipoQueuePlan: 'simple_queue',
        }),
      );
    });

    it('debe detectar ONU automáticamente si no se proporciona serialNumber', async () => {
      await service.ejecutar(dto, mockUser as any);

      expect(mockSmartoltApi.detectarOnuEnPuerto).toHaveBeenCalledWith(
        'smart-olt-001', '0/1/3',
      );
    });

    it('debe aprovisionar ONU con los parámetros correctos en SmartOLT', async () => {
      await service.ejecutar(dto, mockUser as any);

      expect(mockSmartoltApi.aprovisionarOnu).toHaveBeenCalledWith(
        expect.objectContaining({
          serial:   '48575443ABCD1234',
          pon_port: '0/1/3',
          vlan:     100,
          profile:  'HSI-100M',
        }),
      );
    });

    it('debe enviar WhatsApp de bienvenida al cliente', async () => {
      await service.ejecutar(dto, mockUser as any);

      expect(mockWhatsapp.notificarBienvenida).toHaveBeenCalledWith(
        expect.objectContaining({
          clienteNombre:   'Juan Pérez',
          planNombre:      'Plan 30 Mbps',
          velocidadBajada: 30,
          velocidadSubida: 15,
          usuarioPppoe:    'cli_abc12345',
        }),
      );
    });

    it('debe emitir evento "aprovisionamiento.completado"', async () => {
      await service.ejecutar(dto, mockUser as any);

      expect(mockEvents.emit).toHaveBeenCalledWith(
        'aprovisionamiento.completado',
        expect.objectContaining({
          contratoId:   'cnt-001',
          clienteId:    'cli-001',
          usuarioPppoe: 'cli_abc12345',
        }),
      );
    });

    it('debe retornar el serialNumber detectado', async () => {
      const result = await service.ejecutar(dto, mockUser as any);
      expect(result.serialNumber).toBe('48575443ABCD1234');
    });

    it('debe usar serialNumber proporcionado si se da', async () => {
      await service.ejecutar(
        { ...dto, serialNumber: 'MANUALSN123456' } as any,
        mockUser as any,
      );
      // No debe llamar a detectarOnuEnPuerto
      expect(mockSmartoltApi.detectarOnuEnPuerto).not.toHaveBeenCalled();
      // Sí debe aprovisionar con el SN manual
      expect(mockSmartoltApi.aprovisionarOnu).toHaveBeenCalledWith(
        expect.objectContaining({ serial: 'MANUALSN123456' }),
      );
    });
  });

  // ─── Fallo en paso 1 (contrato inválido) ──────────────────
  describe('ejecutar() — fallo en paso 1', () => {
    it('debe retornar exitoso=false y 8 pasos (1 error + 7 omitidos)', async () => {
      // Mockear DS para retornar vacío en paso 1
      const dsMock = { query: jest.fn().mockResolvedValue([]) };
      const m = await Test.createTestingModule({
        providers: [
          OrquestadorAprovisionamientoService,
          { provide: PppoeService,         useValue: mockPppoeSvc },
          { provide: QueueService,         useValue: mockQueueSvc },
          { provide: FirewallService,      useValue: mockFirewallSvc },
          { provide: VelocidadOrquestador, useValue: mockVelocidadOrc },
          { provide: SmartoltApiService,   useValue: mockSmartoltApi },
          { provide: WhatsAppService,      useValue: mockWhatsapp },
          { provide: EventEmitter,        useValue: mockEvents },
          { provide: getDataSourceToken(), useValue: dsMock },
        ],
      }).compile();
      const svc = m.get<OrquestadorAprovisionamientoService>(OrquestadorAprovisionamientoService);

      const result = await svc.ejecutar({
        contratoId: 'no-existe', clienteId: 'cli', oltId: 'olt',
        ponPort: '0/1/0', perfilSmartolt: 'perfil', vlanId: 100, routerId: 'rtr',
      } as any, mockUser as any);

      expect(result.exitoso).toBe(false);
      expect(result.pasos).toHaveLength(8);
      expect(result.pasos[0].estado).toBe('error');
      expect(result.pasos.slice(1).every((p) => p.estado === 'omitido')).toBe(true);
    });
  });

  // ─── Fallo en paso 3 (PPPoE) + rollback ───────────────────
  describe('ejecutar() — fallo en paso 3 con rollback', () => {
    it('debe ejecutar rollback si PPPoE falla', async () => {
      const dsMockSeq = jest.fn()
        .mockResolvedValueOnce([mockContratoRow])        // paso 1
        .mockResolvedValueOnce([mockSegmento])           // paso 2 segmento
        .mockResolvedValueOnce([{ ip_address: '192.168.1.1' }]) // paso 2 ips usadas
        .mockResolvedValue([]);                          // resto

      const pppoeFail = { crear: jest.fn().mockRejectedValue(new Error('Router sin conexión')) };

      const m = await Test.createTestingModule({
        providers: [
          OrquestadorAprovisionamientoService,
          { provide: PppoeService,         useValue: pppoeFail },
          { provide: QueueService,         useValue: mockQueueSvc },
          { provide: FirewallService,      useValue: mockFirewallSvc },
          { provide: VelocidadOrquestador, useValue: mockVelocidadOrc },
          { provide: SmartoltApiService,   useValue: mockSmartoltApi },
          { provide: WhatsAppService,      useValue: mockWhatsapp },
          { provide: EventEmitter,        useValue: mockEvents },
          { provide: getDataSourceToken(), useValue: { query: dsMockSeq } },
        ],
      }).compile();
      const svc = m.get<OrquestadorAprovisionamientoService>(OrquestadorAprovisionamientoService);

      const result = await svc.ejecutar({
        contratoId: 'cnt-001', clienteId: 'cli-001',
        oltId: 'olt-001', ponPort: '0/1/3',
        perfilSmartolt: 'HSI-100M', vlanId: 100,
        routerId: 'rtr-001', segmentoId: 'seg-001',
        rollbackEnError: true,
      } as any, mockUser as any);

      expect(result.exitoso).toBe(false);
      expect(result.rollbackEjecutado).toBe(true);
      expect(result.pasos[2].estado).toBe('error');   // Paso 3 = index 2
      expect(result.pasos[2].detalle).toContain('Router sin conexión');
    });
  });

  // ─── omitirQueue ──────────────────────────────────────────
  describe('ejecutar() — opción omitirQueue', () => {
    it('debe omitir la creación de queue cuando omitirQueue=true', async () => {
      const dsMockOmit = jest.fn()
        .mockResolvedValueOnce([mockContratoRow])
        .mockResolvedValueOnce([mockSegmento])
        .mockResolvedValueOnce([{ ip_address: '192.168.1.1' }])
        .mockResolvedValue([]);

      const m = await Test.createTestingModule({
        providers: [
          OrquestadorAprovisionamientoService,
          { provide: PppoeService,         useValue: mockPppoeSvc },
          { provide: QueueService,         useValue: mockQueueSvc },
          { provide: FirewallService,      useValue: mockFirewallSvc },
          { provide: VelocidadOrquestador, useValue: mockVelocidadOrc },
          { provide: SmartoltApiService,   useValue: mockSmartoltApi },
          { provide: WhatsAppService,      useValue: mockWhatsapp },
          { provide: EventEmitter,        useValue: mockEvents },
          { provide: getDataSourceToken(), useValue: { query: dsMockOmit } },
        ],
      }).compile();
      const svc = m.get<OrquestadorAprovisionamientoService>(OrquestadorAprovisionamientoService);

      await svc.ejecutar({
        contratoId: 'cnt-001', clienteId: 'cli-001',
        oltId: 'olt-001', ponPort: '0/1/3',
        perfilSmartolt: 'HSI-100M', vlanId: 100,
        routerId: 'rtr-001', segmentoId: 'seg-001',
        omitirQueue: true,
      } as any, mockUser as any);

      expect(mockVelocidadOrc.aplicarVelocidad).not.toHaveBeenCalled();
    });
  });

  // ─── Rollback standalone ──────────────────────────────────
  describe('ejecutarRollback()', () => {
    it('debe revertir IP, PPPoE y SmartOLT', async () => {
      const dsMock = jest.fn()
        .mockResolvedValueOnce([{
          router_ip: '192.168.100.1', router_usuario: 'admin', router_pass: 'pass',
          usar_ssl: false, puerto_api: 8728, puerto_api_ssl: 8729,
          version_ros: 'v7', timeout_conexion: 10, router_id: 'rtr-001',
          smartolt_id: 'smart-olt-001', smartolt_onu_id: 'smart-onu-001',
          ip_asignada: '192.168.1.2', usuario_pppoe: 'cli_abc',
          onu_bd_id: 'onu-001', serial_number: '48575443ABCD1234',
        }])
        .mockResolvedValue([]);

      const m = await Test.createTestingModule({
        providers: [
          OrquestadorAprovisionamientoService,
          { provide: PppoeService,         useValue: mockPppoeSvc },
          { provide: QueueService,         useValue: mockQueueSvc },
          { provide: FirewallService,      useValue: mockFirewallSvc },
          { provide: VelocidadOrquestador, useValue: mockVelocidadOrc },
          { provide: SmartoltApiService,   useValue: mockSmartoltApi },
          { provide: WhatsAppService,      useValue: mockWhatsapp },
          { provide: EventEmitter,        useValue: mockEvents },
          { provide: getDataSourceToken(), useValue: { query: dsMock } },
        ],
      }).compile();
      const svc = m.get<OrquestadorAprovisionamientoService>(OrquestadorAprovisionamientoService);

      const result = await svc.ejecutarRollback({
        contratoId:      'cnt-001',
        motivo:          'Test rollback',
        eliminarSmartolt: true,
        eliminarPppoe:    true,
        liberarIp:        true,
      }, undefined, mockUser as any);

      expect(result.revertidos.length).toBeGreaterThan(0);
      expect(result.errores).toHaveLength(0);
      expect(mockSmartoltApi.eliminarProvision).toHaveBeenCalled();
      expect(mockPppoeSvc.eliminar).toHaveBeenCalled();
    });
  });
});

// Importar el DTO para usarlo en los tests
import { AprovisionarFtthDto } from './aprovisionamiento.dto';
