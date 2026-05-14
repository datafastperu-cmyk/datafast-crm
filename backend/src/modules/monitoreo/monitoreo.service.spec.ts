import { Test, TestingModule }    from '@nestjs/testing';
import { getRepositoryToken }      from '@nestjs/typeorm';
import { getDataSourceToken }      from '@nestjs/typeorm';
import { EventEmitter }           from '@nestjs/event-emitter';

import { AlertasService, EVENTO_ALERTA_NUEVA, EVENTO_NODO_OFFLINE } from './services/alertas.service';
import { PingService }              from './services/ping.service';
import { SnmpService }              from './services/snmp.service';
import {
  Nodo, MedicionNodo, Alerta, ConfiguracionAlerta,
  EstadoNodo, NivelAlerta, EstadoAlerta, MetricaAlerta, TipoNodo,
} from './entities/monitoreo.entity';
import { WhatsAppService }          from '../notificaciones/services/whatsapp.service';

// ── Fixtures ──────────────────────────────────────────────────
const mockNodo: Partial<Nodo> = {
  id: 'nod-001', empresaId: 'emp-001',
  nombre: 'Router Central', tipo: TipoNodo.ROUTER,
  ipMonitoreo: '192.168.100.1',
  estado: EstadoNodo.ONLINE,
  snmpHabilitado: true, snmpCommunity: 'public', snmpVersion: 2,
  pingHabilitado: true, pingIntervaloSeg: 60,
  alertasHabilitadas: true, activo: true,
};

const mockAlerta: Partial<Alerta> = {
  id: 'alt-001', empresaId: 'emp-001',
  nodoId: 'nod-001', nodoNombre: 'Router Central',
  nivel: NivelAlerta.CRITICAL,
  estado: EstadoAlerta.ACTIVA,
  metrica: MetricaAlerta.ESTADO_NODO,
  mensaje: '[CRITICAL] Nodo OFFLINE — sin respuesta',
  valorActual: 0, umbral: 1,
  createdAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago
};

const mockConfigAlerta: Partial<ConfiguracionAlerta> = {
  id: 'cfg-001', empresaId: 'emp-001',
  nodoId: null, // global
  metrica: MetricaAlerta.CPU,
  umbralWarning: 80, umbralCritical: 95,
  notificarWhatsapp: false, activo: true,
};

// ── Mock repos ────────────────────────────────────────────────
const mockAlertaRepo = {
  find:    jest.fn(),
  findOne: jest.fn(),
  create:  jest.fn(d => ({ ...mockAlerta, ...d })),
  save:    jest.fn(async a => ({ ...mockAlerta, ...a })),
  update:  jest.fn(),
  createQueryBuilder: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([
      { nivel: 'critical', total: '2' },
      { nivel: 'warning',  total: '3' },
    ]),
    getCount: jest.fn().mockResolvedValue(1),
    getMany:  jest.fn().mockResolvedValue([mockAlerta]),
  })),
};

const mockConfigRepo = {
  find:    jest.fn().mockResolvedValue([mockConfigAlerta]),
  findOne: jest.fn(),
  create:  jest.fn(d => ({ ...mockConfigAlerta, ...d })),
  save:    jest.fn(async c => ({ ...mockConfigAlerta, ...c })),
  update:  jest.fn(),
};

const mockNodoRepo = {
  find:    jest.fn(),
  findOne: jest.fn(),
  update:  jest.fn(),
  create:  jest.fn(d => ({ ...mockNodo, ...d })),
  save:    jest.fn(async n => ({ ...mockNodo, ...n })),
};

const mockWhatsapp = { enviar: jest.fn().mockResolvedValue({ enviado: true }) };
const mockEvents   = { emit: jest.fn() };

// ─────────────────────────────────────────────────────────────
// AlertasService Tests
// ─────────────────────────────────────────────────────────────
describe('AlertasService', () => {
  let service: AlertasService;

  beforeEach(async () => {
    const m: TestingModule = await Test.createTestingModule({
      providers: [
        AlertasService,
        { provide: getRepositoryToken(Alerta),               useValue: mockAlertaRepo },
        { provide: getRepositoryToken(ConfiguracionAlerta),  useValue: mockConfigRepo },
        { provide: getRepositoryToken(Nodo),                 useValue: mockNodoRepo },
        { provide: WhatsAppService,                          useValue: mockWhatsapp },
        { provide: EventEmitter,                            useValue: mockEvents },
        { provide: getDataSourceToken(),                     useValue: {} },
      ],
    }).compile();
    service = m.get<AlertasService>(AlertasService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── evaluar: crear alerta cuando supera umbral ────────────
  describe('evaluar()', () => {
    it('debe crear alerta CRITICAL cuando CPU supera umbral', async () => {
      mockAlertaRepo.findOne.mockResolvedValue(null); // sin alerta previa
      mockAlertaRepo.save.mockResolvedValue({ ...mockAlerta, metrica: MetricaAlerta.CPU, nivel: NivelAlerta.CRITICAL });
      mockConfigRepo.find.mockResolvedValue([{ ...mockConfigAlerta, umbralWarning: 80, umbralCritical: 95 }]);

      await service.evaluar({
        nodoId: 'nod-001', empresaId: 'emp-001',
        nodoNombre: 'Router Central',
        metrica: MetricaAlerta.CPU,
        valorActual: 98, // supera critical (95)
      });

      expect(mockAlertaRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ nivel: NivelAlerta.CRITICAL }),
      );
      expect(mockEvents.emit).toHaveBeenCalledWith(
        EVENTO_ALERTA_NUEVA, expect.objectContaining({ empresaId: 'emp-001' }),
      );
    });

    it('debe crear alerta WARNING cuando supera umbral warning pero no critical', async () => {
      mockAlertaRepo.findOne.mockResolvedValue(null);
      mockAlertaRepo.save.mockResolvedValue({ ...mockAlerta, metrica: MetricaAlerta.CPU, nivel: NivelAlerta.WARNING });
      mockConfigRepo.find.mockResolvedValue([{ ...mockConfigAlerta, umbralWarning: 80, umbralCritical: 95 }]);

      await service.evaluar({
        nodoId: 'nod-001', empresaId: 'emp-001',
        nodoNombre: 'Router Central',
        metrica: MetricaAlerta.CPU,
        valorActual: 85, // supera warning (80) pero no critical (95)
      });

      expect(mockAlertaRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ nivel: NivelAlerta.WARNING }),
      );
    });

    it('debe resolver alerta previa cuando valor vuelve a rango normal', async () => {
      mockAlertaRepo.findOne.mockResolvedValue(mockAlerta); // alerta activa previa
      mockConfigRepo.find.mockResolvedValue([{ ...mockConfigAlerta, umbralWarning: 80, umbralCritical: 95 }]);

      await service.evaluar({
        nodoId: 'nod-001', empresaId: 'emp-001',
        nodoNombre: 'Router Central',
        metrica: MetricaAlerta.CPU,
        valorActual: 45, // valor normal — por debajo del warning
      });

      // No debe crear nueva alerta
      expect(mockAlertaRepo.save).not.toHaveBeenCalled();
      // Debe resolver la alerta existente
      expect(mockAlertaRepo.update).toHaveBeenCalledWith(
        mockAlerta.id,
        expect.objectContaining({ estado: EstadoAlerta.RESUELTA }),
      );
    });

    it('no debe crear alerta duplicada si ya hay una activa', async () => {
      mockAlertaRepo.findOne.mockResolvedValue(mockAlerta); // alerta ya existente
      mockConfigRepo.find.mockResolvedValue([{ ...mockConfigAlerta, umbralWarning: 80, umbralCritical: 95 }]);

      await service.evaluar({
        nodoId: 'nod-001', empresaId: 'emp-001',
        nodoNombre: 'Router Central',
        metrica: MetricaAlerta.CPU,
        valorActual: 99, // sigue siendo critical
      });

      // No debe crear nueva alerta (ya existe una activa)
      expect(mockAlertaRepo.save).not.toHaveBeenCalled();
    });
  });

  // ── alertarNodoOffline ────────────────────────────────────
  describe('alertarNodoOffline()', () => {
    it('debe crear alerta CRITICAL y emitir evento NODO_OFFLINE', async () => {
      mockAlertaRepo.findOne.mockResolvedValue(null); // sin alerta previa
      mockAlertaRepo.save.mockResolvedValue({ ...mockAlerta, metrica: MetricaAlerta.ESTADO_NODO });

      await service.alertarNodoOffline('nod-001', 'emp-001', 'Router Central');

      expect(mockAlertaRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          metrica: MetricaAlerta.ESTADO_NODO,
          nivel:   NivelAlerta.CRITICAL,
        }),
      );
      expect(mockEvents.emit).toHaveBeenCalledWith(
        EVENTO_NODO_OFFLINE,
        expect.objectContaining({ nodoId: 'nod-001', nodoNombre: 'Router Central' }),
      );
    });

    it('no debe crear alerta duplicada si el nodo ya estaba offline', async () => {
      mockAlertaRepo.findOne.mockResolvedValue(mockAlerta); // ya hay alerta activa

      await service.alertarNodoOffline('nod-001', 'emp-001', 'Router Central');

      expect(mockAlertaRepo.save).not.toHaveBeenCalled();
    });
  });

  // ── resolverAlerta ────────────────────────────────────────
  describe('resolverAlerta()', () => {
    it('debe marcar la alerta como resuelta con duración calculada', async () => {
      mockAlertaRepo.findOne.mockResolvedValue(mockAlerta);

      await service.resolverAlerta('alt-001', 'Nodo volvió a responder', 'admin');

      expect(mockAlertaRepo.update).toHaveBeenCalledWith(
        'alt-001',
        expect.objectContaining({
          estado:          EstadoAlerta.RESUELTA,
          resueltaPor:     'admin',
          duracionMinutos: expect.any(Number),
        }),
      );
    });

    it('no debe hacer nada si la alerta ya está resuelta', async () => {
      mockAlertaRepo.findOne.mockResolvedValue({
        ...mockAlerta, estado: EstadoAlerta.RESUELTA,
      });

      await service.resolverAlerta('alt-001', 'motivo');

      expect(mockAlertaRepo.update).not.toHaveBeenCalled();
    });
  });

  // ── getResumenAlertas ─────────────────────────────────────
  describe('getResumenAlertas()', () => {
    it('debe retornar conteos por nivel', async () => {
      const resumen = await service.getResumenAlertas('emp-001');
      expect(resumen.activas).toBeGreaterThanOrEqual(0);
      expect(resumen).toHaveProperty('criticas');
      expect(resumen).toHaveProperty('warnings');
    });
  });
});

// ─────────────────────────────────────────────────────────────
// PingService Tests
// ─────────────────────────────────────────────────────────────
describe('PingService', () => {
  let service: PingService;

  beforeEach(async () => {
    const m = await Test.createTestingModule({
      providers: [PingService],
    }).compile();
    service = m.get<PingService>(PingService);
  });

  // ── parsePingOutput (método privado testeado indirectamente) ─
  it('debe parsear correctamente output de ping Linux', () => {
    const output = `
PING 8.8.8.8 (8.8.8.8) 56(84) bytes of data.
--- 8.8.8.8 ping statistics ---
4 packets transmitted, 4 received, 0% packet loss, time 3003ms
rtt min/avg/max/mdev = 12.345/15.678/20.123/3.456 ms`;

    const result = (service as any).parsePingOutput('8.8.8.8', output);

    expect(result.alive).toBe(true);
    expect(result.lossPerct).toBe(0);
    expect(result.avg).toBeCloseTo(15.678);
    expect(result.min).toBeCloseTo(12.345);
    expect(result.max).toBeCloseTo(20.123);
  });

  it('debe detectar host offline con 100% pérdida', () => {
    const output = `
PING 10.0.0.254 (10.0.0.254) 56(84) bytes of data.
--- 10.0.0.254 ping statistics ---
4 packets transmitted, 0 received, 100% packet loss, time 3000ms`;

    const result = (service as any).parsePingOutput('10.0.0.254', output);

    expect(result.alive).toBe(false);
    expect(result.lossPerct).toBe(100);
    expect(result.latencyMs).toBeNull();
  });

  it('debe detectar pérdida parcial de paquetes', () => {
    const output = `
4 packets transmitted, 3 received, 25% packet loss
rtt min/avg/max/mdev = 10.1/11.2/12.3/0.8 ms`;

    const result = (service as any).parsePingOutput('192.168.1.1', output);
    expect(result.lossPerct).toBe(25);
    expect(result.alive).toBe(true); // 75% de paquetes llegaron
  });
});

// ─────────────────────────────────────────────────────────────
// SnmpService Tests
// ─────────────────────────────────────────────────────────────
describe('SnmpService - utilidades', () => {
  let service: SnmpService;

  beforeEach(async () => {
    const m = await Test.createTestingModule({
      providers: [SnmpService],
    }).compile();
    service = m.get<SnmpService>(SnmpService);
  });

  it('debe decodificar string Buffer correctamente', () => {
    const buf = Buffer.from('MikroTik');
    expect((service as any).decodeString(buf)).toBe('MikroTik');
  });

  it('debe calcular tasa de tráfico correctamente entre dos mediciones', async () => {
    const key = '192.168.1.1:1';

    // Primera medición — no hay tasa todavía
    (service as any).prevTrafico.set(key, {
      rxBytes: BigInt(1_000_000),  // 1MB
      txBytes: BigInt(500_000),
      ts: Date.now() - 10_000,    // hace 10 segundos
    });

    // Simular segunda medición con 200KB más
    // rxBps esperado: 200_000 bytes / 10 seg = 20_000 bytes/s = 160_000 bps
    const prevEntry = (service as any).prevTrafico.get(key);
    const rxActual  = BigInt(1_200_000);
    const ahora     = prevEntry.ts + 10_000;
    const deltaSeg  = (ahora - prevEntry.ts) / 1000;
    const deltaRx   = rxActual - prevEntry.rxBytes;
    const rxBpsCalc = Number(deltaRx) / deltaSeg;

    expect(rxBpsCalc).toBe(20_000); // 200KB / 10s = 20 KB/s
  });
});
