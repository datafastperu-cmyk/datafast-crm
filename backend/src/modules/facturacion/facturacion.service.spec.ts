import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { FacturacionService } from './facturacion.service';
import { FacturaRepository } from './repositories/factura.repository';
import { ComprobantesConfigService } from './comprobantes-config.service';
import { PdfService } from './pdf.service';
import { AuditoriaService } from '../auth/auditoria.service';
import { DeudaPorContratoService } from './deuda-por-contrato.service';
import { PoliticaFacturacionService } from './politica-facturacion.service';
import { Factura, EstadoFactura } from './entities/factura.entity';

// NOTA (2026-07-28): esta suite llevaba tiempo SIN EJECUTARSE — no compilaba porque
// importaba el enum `TipoComprobante`, retirado a propósito cuando el tipo de comprobante
// pasó a ser un código libre configurable por empresa (`comprobantes_config`), en vez de
// una lista fija en el código. Al no compilar, jest abortaba la suite entera: el módulo
// más crítico del ERP quedó sin cobertura activa, y así se colaron cinco queries rotas
// contra columnas migradas que ninguna prueba detectó.
//
// El tipo de comprobante es ahora el `codigo` del ComprobanteConfig ('boleta', 'fac',
// 'ci'…) y una nota de crédito usa el prefijo `nc_` sobre el original — ver
// facturacion.service.ts::crearNotaCredito.
const TIPO_BOLETA       = 'boleta';
const TIPO_NOTA_CREDITO = 'nc_boleta';

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
  tipoComprobante: TIPO_BOLETA,
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

// El IGV y la serie ya NO salen de `empresas`: los resuelve ComprobantesConfigService
// desde `configuracion_facturacion` y `comprobantes_config`. Este mock refleja esa
// estructura — un mock que siguiera devolviendo `empresas.igv_rate` volvería a validar
// un modelo que no existe, que es como la suite dejó pasar las queries rotas.
const mockComprobantesSvc = {
  resolverParaCliente: jest.fn().mockResolvedValue({
    id: 'cc-001', codigo: TIPO_BOLETA, nombre: 'Boleta',
    serie: 'B001', tieneCargaFiscal: true,
  }),
  getConfiguracion: jest.fn().mockResolvedValue({ igvRate: 0.18, moneda: 'PEN' }),
  siguienteCorrelativo: jest.fn().mockResolvedValue({ serie: 'B001', correlativo: 1 }),
};

const mockDs = {
  query: jest.fn().mockResolvedValue([{
    razon_social: 'Test ISP', ruc: '20600000001',
    nombre_completo: 'Juan Pérez', tipo_documento: 'dni',
    numero_documento: '12345678', direccion: 'Av. Lima',
  }]),
  transaction: jest.fn(async (cb: any) => cb({
    query: jest.fn().mockResolvedValue([{ siguiente: 1 }]),
  })),
};

// ─── Tests ────────────────────────────────────────────────────
describe('FacturacionService', () => {
  let service: FacturacionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FacturacionService,
        { provide: FacturaRepository,          useValue: mockRepo },
        { provide: ComprobantesConfigService,  useValue: mockComprobantesSvc },
        { provide: PdfService,                 useValue: mockPdfSvc },
        { provide: AuditoriaService,           useValue: mockAuditoria },
        // La deuda por contrato se recalcula tras emitir; aquí no se ejercita.
        { provide: DeudaPorContratoService,    useValue: { recalcularPorCliente: jest.fn(), calcular: jest.fn() } },
        { provide: PoliticaFacturacionService, useValue: new PoliticaFacturacionService(mockDs as never) },
        { provide: getDataSourceToken(),       useValue: mockDs },
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
      mockRepo.save.mockResolvedValue({ ...mockFactura, id: 'nc-001', tipoComprobante: TIPO_NOTA_CREDITO });

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
  //
  // `aplicarPago` se reescribió como un UPDATE ATÓMICO con las condiciones en el WHERE,
  // para eliminar la race condition de leer-calcular-escribir (dos pagos simultáneos
  // sobre la misma factura podían dejarla sobrepagada). Los tests anteriores seguían
  // simulando el flujo viejo `findById` + `update` y por eso no verificaban nada real.
  //
  // El driver de Postgres devuelve `[filas, rowCount]` en un UPDATE ... RETURNING, así
  // que el mock IMITA ESA FORMA: un mock más cómodo dejaría pasar justo la clase de bug
  // que ya nos costó un outbox sin drenar.
  describe('aplicarPago()', () => {
    const updateDevuelve = (filas: any[]) => {
      mockDs.query.mockResolvedValueOnce([filas, filas.length]);
    };

    it('marca como PAGADA cuando el pago cubre el total', async () => {
      updateDevuelve([{ id: 'fac-001', estado: EstadoFactura.PAGADA }]);
      mockRepo.findById.mockResolvedValue({ ...mockFactura, estado: EstadoFactura.PAGADA, montoPagado: 85 });

      const result = await service.aplicarPago('fac-001', 85, 'emp-001', '2024-01-20');

      expect(result.estado).toBe(EstadoFactura.PAGADA);
      // El estado lo decide el SQL, no el código: se comprueba que la condición viaje
      // en el WHERE en lugar de calcularse en memoria.
      const [sql] = mockDs.query.mock.calls[0];
      expect(sql).toMatch(/UPDATE\s+facturas/i);
      expect(sql).toMatch(/estado NOT IN \('pagada', 'anulada'\)/i);
    });

    it('marca como PAGADA_PARCIAL si el pago no cubre el total', async () => {
      updateDevuelve([{ id: 'fac-001', estado: EstadoFactura.PAGADA_PARCIAL }]);
      mockRepo.findById.mockResolvedValue({ ...mockFactura, estado: EstadoFactura.PAGADA_PARCIAL, montoPagado: 40 });

      const result = await service.aplicarPago('fac-001', 40, 'emp-001', '2024-01-20');

      expect(result.estado).toBe(EstadoFactura.PAGADA_PARCIAL);
    });

    it('rechaza el pago a una factura anulada', async () => {
      // El UPDATE no toca ninguna fila (lo impide el WHERE) → el servicio averigua por
      // qué y devuelve el motivo concreto en vez de un fallo genérico.
      updateDevuelve([]);
      mockRepo.findById.mockResolvedValue({ ...mockFactura, estado: EstadoFactura.ANULADA });

      await expect(
        service.aplicarPago('fac-001', 85, 'emp-001', '2024-01-20'),
      ).rejects.toThrow(/anulada/i);
    });

    it('rechaza un pago que excede el saldo pendiente', async () => {
      updateDevuelve([]);
      mockRepo.findById.mockResolvedValue({ ...mockFactura, estado: EstadoFactura.EMITIDA, total: 85, montoPagado: 80 });

      await expect(
        service.aplicarPago('fac-001', 50, 'emp-001', '2024-01-20'),
      ).rejects.toThrow(/excede el saldo/i);
    });
  });

  // ── Marcar vencidas ────────────────────────────────────────
  describe('marcarVencidas()', () => {
    it('marca en UN SOLO UPDATE las facturas con vencimiento pasado', async () => {
      // Antes se recorrían las facturas una por una; ahora es un update masivo. Un
      // recorrido fila a fila sobre miles de facturas era el cuello de botella.
      const execute = jest.fn().mockResolvedValue({ affected: 2 });
      const qb: any = {
        update:   jest.fn(() => qb),
        set:      jest.fn(() => qb),
        where:    jest.fn(() => qb),
        andWhere: jest.fn(() => qb),
        execute,
      };
      (mockDs as any).createQueryBuilder = jest.fn(() => qb);

      const count = await service.marcarVencidas();

      expect(count).toBe(2);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(qb.set).toHaveBeenCalledWith({ estado: EstadoFactura.VENCIDA });
    });

    it('devuelve 0 sin fallar cuando no hay nada que vencer', async () => {
      const qb: any = {
        update: jest.fn(() => qb), set: jest.fn(() => qb),
        where: jest.fn(() => qb), andWhere: jest.fn(() => qb),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };
      (mockDs as any).createQueryBuilder = jest.fn(() => qb);

      expect(await service.marcarVencidas()).toBe(0);
    });
  });

  // ── Nota de crédito ───────────────────────────────────────
  describe('crearNotaCredito()', () => {
    it('debe crear nota de crédito referenciando factura original', async () => {
      mockRepo.findById.mockResolvedValue({ ...mockFactura, tipoComprobante: TIPO_BOLETA });
      mockRepo.siguienteCorrelativo.mockResolvedValue(1);
      mockRepo.save.mockResolvedValue({ ...mockFactura, id: 'nc-001', tipoComprobante: TIPO_NOTA_CREDITO, serie: 'BC01' });

      const nc = await service.crearNotaCredito(
        { facturaOriginalId: 'fac-001', motivo: 'Error de facturación' },
        mockUser as any,
      );

      expect(nc.tipoComprobante).toBe(TIPO_NOTA_CREDITO);
      expect(mockRepo.save).toHaveBeenCalled();
    });
  });
});
