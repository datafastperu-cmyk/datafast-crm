import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { FacturacionService } from './facturacion.service';
import { FacturaRepository } from './repositories/factura.repository';
import { PdfService } from './pdf.service';
import { AuditoriaService } from '../auth/auditoria.service';
import { ConfigService } from '@nestjs/config';
import { Factura, EstadoFactura, TipoComprobante } from './entities/factura.entity';

// ── Mocks ─────────────────────────────────────────────────────
const mockUser = {
  sub: 'user-001', email: 'admin@test.pe',
  empresaId: 'emp-001', roles: ['Administrador'],
  permisos: [], nombreCompleto: 'Admin', tema: 'dark',
};

const mockFactura: Partial<Factura> = {
  id:             'fac-001',
  empresaId:      'emp-001',
  clienteId:      'cli-001',
  contratoId:     'cnt-001',
  tipoComprobante: TipoComprobante.BOLETA,
  serie:          'B001',
  correlativo:    1,
  numeroCompleto: 'B001-00000001',
  subtotal:       72.03,
  descuento:      0,
  igv:            12.97,
  total:          85.00,
  montoPagado:    0,
  estado:         EstadoFactura.EMITIDA,
  fechaEmision:   '2024-01-15',
  fechaVencimiento: '2024-01-20',
  periodoInicio:  '2024-01-01',
  periodoFin:     '2024-01-31',
  descripcion:    'Servicio de internet',
  items:          [],
  moneda:         'PEN',
  generadaAutomaticamente: false,
  deletedAt:      null,
  createdAt:      new Date(),
  updatedAt:      new Date(),
};

const mockRepo = {
  create:           jest.fn(d => ({ ...mockFactura, ...d })),
  save:             jest.fn(async f => ({ ...mockFactura, ...f })),
  update:           jest.fn(),
  findById:         jest.fn(),
  findByContrato:   jest.fn(),
  findByCliente:    jest.fn(),
  findAllPaginated: jest.fn(),
  siguienteCorrelativo: jest.fn(),
  existeFacturaPeriodo: jest.fn(),
  findContratosParaFacturar: jest.fn(),
  findFacturasParaVencer:    jest.fn(),
  findPendientesPorContrato: jest.fn(),
  getResumenFinanciero:      jest.fn(),
  softDelete: jest.fn(),
  buildFilterQuery: jest.fn(),
};

const mockPdfSvc   = { generarFacturaPdf: jest.fn().mockResolvedValue('/uploads/facturas/test.pdf') };
const mockAuditoria = { log: jest.fn(), logCreate: jest.fn(), logUpdate: jest.fn() };
const mockConfig   = { get: jest.fn((k, d) => {
  const cfg = { 'app.billing.igvRate': 0.18, 'app.billing.graceDays': 5 };
  return cfg[k] ?? d;
}) };
const mockDs = {
  query: jest.fn().mockResolvedValue([{
    razon_social: 'Test ISP', ruc: '20600000001',
    nombre_completo: 'Juan Pérez', tipo_documento: 'dni',
    numero_documento: '12345678', direccion: 'Av. Lima',
    serie_boleta: 'B001', serie_factura: 'F001',
  }]),
};

// ─── Tests ────────────────────────────────────────────────────
describe('FacturacionService', () => {
  let service: FacturacionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FacturacionService,
        { provide: FacturaRepository,       useValue: mockRepo },
        { provide: PdfService,              useValue: mockPdfSvc },
        { provide: AuditoriaService,        useValue: mockAuditoria },
        { provide: ConfigService,           useValue: mockConfig },
        { provide: getDataSourceToken(),    useValue: mockDs },
      ],
    }).compile();
    service = module.get<FacturacionService>(FacturacionService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── Cálculo de IGV ────────────────────────────────────────
  describe('Cálculo de montos con IGV', () => {
    it('debe calcular IGV 18% correctamente sobre base', async () => {
      mockRepo.siguienteCorrelativo.mockResolvedValue(1);
      mockRepo.save.mockResolvedValue({ ...mockFactura });

      const dto = {
        clienteId:    'cli-001',
        periodoInicio:'2024-01-01',
        periodoFin:   '2024-01-31',
        subtotal:     72.03,
        aplicaIgv:    true,
      };

      const result = await service.create(dto as any, mockUser as any);

      // IGV = 72.03 * 0.18 = 12.9654 ≈ 12.97
      // Total = 72.03 + 12.97 = 85.00
      expect(result.igv).toBeCloseTo(12.97, 1);
      expect(result.total).toBeCloseTo(85.00, 1);
    });

    it('debe calcular sin IGV cuando aplicaIgv=false', async () => {
      mockRepo.siguienteCorrelativo.mockResolvedValue(2);
      mockRepo.save.mockResolvedValue({ ...mockFactura, igv: 0, total: 85 });

      const dto = {
        clienteId: 'cli-001', periodoInicio: '2024-01-01', periodoFin: '2024-01-31',
        subtotal: 85, aplicaIgv: false,
      };
      const result = await service.create(dto as any, mockUser as any);
      expect(result.igv).toBe(0);
    });

    it('debe calcular desde items con múltiples líneas', async () => {
      mockRepo.siguienteCorrelativo.mockResolvedValue(3);
      mockRepo.save.mockImplementation(async f => f);

      const dto = {
        clienteId: 'cli-001', periodoInicio: '2024-01-01', periodoFin: '2024-01-31',
        aplicaIgv: true,
        items: [
          { descripcion: 'Plan 30Mbps', cantidad: 1, precioUnitario: 72.03, descuento: 0 },
          { descripcion: 'IP Fija adicional', cantidad: 1, precioUnitario: 15.00, descuento: 0 },
        ],
      };
      const result = await service.create(dto as any, mockUser as any);
      // subtotal = 72.03 + 15 = 87.03
      expect(result.subtotal).toBeCloseTo(87.03, 2);
    });
  });

  // ── Anulación ─────────────────────────────────────────────
  describe('anular()', () => {
    it('debe anular una factura emitida', async () => {
      mockRepo.findById.mockResolvedValue({ ...mockFactura, estado: EstadoFactura.EMITIDA });
      mockRepo.update.mockResolvedValue({});
      mockRepo.siguienteCorrelativo.mockResolvedValue(1);
      mockRepo.save.mockResolvedValue({ ...mockFactura, id: 'nc-001', tipoComprobante: TipoComprobante.NOTA_CREDITO });

      const result = await service.anular(
        'fac-001',
        { motivo: 'Error en monto', crearNotaCredito: false },
        mockUser as any,
      );

      expect(mockRepo.update).toHaveBeenCalledWith('fac-001', expect.objectContaining({ estado: EstadoFactura.ANULADA }));
    });

    it('NO debe anular una factura pagada', async () => {
      mockRepo.findById.mockResolvedValue({ ...mockFactura, estado: EstadoFactura.PAGADA });
      await expect(
        service.anular('fac-001', { motivo: 'test', crearNotaCredito: false }, mockUser as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('NO debe anular una ya anulada', async () => {
      mockRepo.findById.mockResolvedValue({ ...mockFactura, estado: EstadoFactura.ANULADA });
      await expect(
        service.anular('fac-001', { motivo: 'test' }, mockUser as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── Aplicar pago ──────────────────────────────────────────
  describe('aplicarPago()', () => {
    it('debe marcar como PAGADA al cubrir el total', async () => {
      mockRepo.findById
        .mockResolvedValueOnce({ ...mockFactura, montoPagado: 0, total: 85 })
        .mockResolvedValueOnce({ ...mockFactura, estado: EstadoFactura.PAGADA });

      const result = await service.aplicarPago('fac-001', 85, 'emp-001', '2024-01-20');
      expect(mockRepo.update).toHaveBeenCalledWith('fac-001', expect.objectContaining({ estado: EstadoFactura.PAGADA }));
    });

    it('debe marcar como PAGADA_PARCIAL si el pago es parcial', async () => {
      mockRepo.findById
        .mockResolvedValueOnce({ ...mockFactura, montoPagado: 0, total: 85 })
        .mockResolvedValueOnce({ ...mockFactura, estado: EstadoFactura.PAGADA_PARCIAL });

      await service.aplicarPago('fac-001', 40, 'emp-001', '2024-01-20');
      expect(mockRepo.update).toHaveBeenCalledWith('fac-001', expect.objectContaining({ estado: EstadoFactura.PAGADA_PARCIAL }));
    });

    it('no debe aplicar pago a factura anulada', async () => {
      mockRepo.findById.mockResolvedValue({ ...mockFactura, estado: EstadoFactura.ANULADA });
      await expect(
        service.aplicarPago('fac-001', 85, 'emp-001', '2024-01-20'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── Marcar vencidas ────────────────────────────────────────
  describe('marcarVencidas()', () => {
    it('debe marcar facturas con fecha de vencimiento pasada', async () => {
      const vencidas = [
        { ...mockFactura, id: 'fac-001' },
        { ...mockFactura, id: 'fac-002' },
      ];
      mockRepo.findFacturasParaVencer.mockResolvedValue(vencidas);
      mockRepo.update.mockResolvedValue({});

      const count = await service.marcarVencidas();
      expect(count).toBe(2);
      expect(mockRepo.update).toHaveBeenCalledTimes(2);
    });
  });

  // ── Nota de crédito ───────────────────────────────────────
  describe('crearNotaCredito()', () => {
    it('debe crear nota de crédito referenciando factura original', async () => {
      mockRepo.findById.mockResolvedValue({ ...mockFactura, tipoComprobante: TipoComprobante.BOLETA });
      mockRepo.siguienteCorrelativo.mockResolvedValue(1);
      mockRepo.save.mockResolvedValue({ ...mockFactura, id: 'nc-001', tipoComprobante: TipoComprobante.NOTA_CREDITO, serie: 'BC01' });

      const nc = await service.crearNotaCredito(
        { facturaOriginalId: 'fac-001', motivo: 'Error de facturación' },
        mockUser as any,
      );

      expect(nc.tipoComprobante).toBe(TipoComprobante.NOTA_CREDITO);
      expect(mockRepo.save).toHaveBeenCalled();
    });
  });
});
