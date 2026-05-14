import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException, NotFoundException,
  BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { PagosService }        from './pagos.service';
import { PagoRepository }      from './repositories/pago.repository';
import { MercadoPagoService }  from './mercadopago.service';
import { FacturacionService }  from '../facturacion/facturacion.service';
import { ContratosService }    from '../contratos/contratos.service';
import { AuditoriaService }    from '../auth/auditoria.service';
import { ConfigService }       from '@nestjs/config';
import { Pago, MetodoPago, EstadoPago } from './entities/pago.entity';
import { EstadoContrato }      from '../contratos/entities/contrato.entity';
import { EstadoFactura }       from '../facturacion/entities/factura.entity';

// ── Fixtures ──────────────────────────────────────────────────
const mockUser = {
  sub: 'usr-001', email: 'cajero@test.pe',
  empresaId: 'emp-001', roles: ['Cajero'],
  permisos: ['pagos:create'], nombreCompleto: 'Cajero Test', tema: 'dark',
};

const mockPago: Partial<Pago> = {
  id: 'pag-001', empresaId: 'emp-001', clienteId: 'cli-001',
  facturaId: 'fac-001', contratoId: 'cnt-001',
  monto: 85, moneda: 'PEN', metodoPago: MetodoPago.YAPE,
  numeroOperacion: 'YAP12345678', banco: null,
  estado: EstadoPago.PENDIENTE_VERIFICACION,
  fechaPago: '2024-01-20', registradoEn: new Date(),
  conciliado: false, createdAt: new Date(), updatedAt: new Date(),
};

const mockFacturaRow = {
  id: 'fac-001', estado: EstadoFactura.EMITIDA,
  empresa_id: 'emp-001', cliente_id: 'cli-001', contrato_id: 'cnt-001',
  total: 85, saldo: 85,
};

const mockContratoSuspendido = {
  id: 'cnt-001', empresaId: 'emp-001',
  estado: EstadoContrato.SUSPENDIDO_MORA,
  deudaTotal: 85, mesesDeuda: 1,
};

const mockContratoActivo = {
  id: 'cnt-001', empresaId: 'emp-001',
  estado: EstadoContrato.ACTIVO,
  deudaTotal: 0, mesesDeuda: 0,
};

// ── Mocks de repositorios / servicios ────────────────────────
const mockRepo = {
  create:                jest.fn(d => ({ ...mockPago, ...d })),
  save:                  jest.fn(async p => ({ ...mockPago, ...p })),
  update:                jest.fn(),
  findById:              jest.fn(),
  findByFactura:         jest.fn(),
  findByContrato:        jest.fn(),
  findByCliente:         jest.fn(),
  findAllPaginated:      jest.fn(),
  buildFilterQuery:      jest.fn(),
  existeDuplicado:       jest.fn(),
  findByMpPaymentId:     jest.fn(),
  findPendientesVerificar: jest.fn(),
  findVerificadosPeriodo: jest.fn(),
  calcularDeudaContrato: jest.fn(),
  findFacturasPendientes: jest.fn(),
  getResumenCobranza:    jest.fn(),
  findUltimos:           jest.fn(),
  findCuentas:           jest.fn(),
  saveCuenta:            jest.fn(),
  createCuenta:          jest.fn(),
};

const mockMpSvc = {
  crearPreferencia:         jest.fn(),
  consultarPago:            jest.fn(),
  validarWebhookSignature:  jest.fn().mockReturnValue(true),
  esAprobado:               jest.fn(),
  esPendiente:              jest.fn(),
};

const mockFacturacionSvc = {
  findOne:    jest.fn(),
  aplicarPago: jest.fn(),
};

const mockContratosSvc = {
  findOne:         jest.fn(),
  cambiarEstado:   jest.fn(),
  actualizarDeuda: jest.fn(),
};

const mockAuditoria = {
  log: jest.fn(), logCreate: jest.fn(), logUpdate: jest.fn(),
};

const mockConfig = { get: jest.fn((k, d) => d) };

const mockDs = {
  query: jest.fn().mockResolvedValue([mockFacturaRow]),
};

// ─── Tests ────────────────────────────────────────────────────
describe('PagosService', () => {
  let service: PagosService;

  beforeEach(async () => {
    const m = await Test.createTestingModule({
      providers: [
        PagosService,
        { provide: PagoRepository,      useValue: mockRepo },
        { provide: MercadoPagoService,  useValue: mockMpSvc },
        { provide: FacturacionService,  useValue: mockFacturacionSvc },
        { provide: ContratosService,    useValue: mockContratosSvc },
        { provide: AuditoriaService,    useValue: mockAuditoria },
        { provide: ConfigService,       useValue: mockConfig },
        { provide: getDataSourceToken(), useValue: mockDs },
      ],
    }).compile();
    service = m.get<PagosService>(PagosService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── Registrar pago ────────────────────────────────────────
  describe('registrar()', () => {

    it('debe registrar pago Yape como PENDIENTE_VERIFICACION', async () => {
      mockRepo.existeDuplicado.mockResolvedValue({ existe: false });
      mockDs.query.mockResolvedValue([mockFacturaRow]);
      mockRepo.save.mockResolvedValue({ ...mockPago, estado: EstadoPago.PENDIENTE_VERIFICACION });

      const dto = {
        clienteId: 'cli-001', facturaId: 'fac-001', contratoId: 'cnt-001',
        monto: 85, metodoPago: MetodoPago.YAPE, numeroOperacion: 'YAP12345678',
      };

      const result = await service.registrar(dto as any, mockUser as any);
      expect(result.estado).toBe(EstadoPago.PENDIENTE_VERIFICACION);
      expect(mockRepo.save).toHaveBeenCalled();
    });

    it('debe rechazar duplicado por número de operación', async () => {
      mockDs.query.mockResolvedValue([mockFacturaRow]);
      mockRepo.existeDuplicado.mockResolvedValue({ existe: true, pagoExistente: mockPago });

      await expect(service.registrar({
        clienteId: 'cli-001', facturaId: 'fac-001',
        monto: 85, metodoPago: MetodoPago.YAPE,
        numeroOperacion: 'YAP12345678',
      } as any, mockUser as any)).rejects.toThrow(ConflictException);
    });

    it('debe requerir número de operación para Yape/Plin/Transferencia', async () => {
      mockDs.query.mockResolvedValue([mockFacturaRow]);
      await expect(service.registrar({
        clienteId: 'cli-001', facturaId: 'fac-001',
        monto: 85, metodoPago: MetodoPago.YAPE,
        // Sin numeroOperacion
      } as any, mockUser as any)).rejects.toThrow(BadRequestException);
    });

    it('debe auto-verificar efectivo y aplicar a factura', async () => {
      mockRepo.existeDuplicado.mockResolvedValue({ existe: false });
      mockDs.query.mockResolvedValue([mockFacturaRow]);
      const pagoVerificado = { ...mockPago, estado: EstadoPago.VERIFICADO, metodoPago: MetodoPago.EFECTIVO };
      mockRepo.save.mockResolvedValue(pagoVerificado);
      mockRepo.findById.mockResolvedValue(pagoVerificado);
      mockRepo.calcularDeudaContrato.mockResolvedValue({ deuda: 0, meses: 0 });
      mockContratosSvc.actualizarDeuda.mockResolvedValue(undefined);
      mockContratosSvc.findOne.mockResolvedValue(mockContratoActivo);

      const result = await service.registrar({
        clienteId: 'cli-001', facturaId: 'fac-001', contratoId: 'cnt-001',
        monto: 85, metodoPago: MetodoPago.EFECTIVO, autoVerificar: true,
      } as any, mockUser as any);

      expect(mockFacturacionSvc.aplicarPago).toHaveBeenCalled();
    });
  });

  // ── Verificar pago ────────────────────────────────────────
  describe('verificar()', () => {

    it('al aprobar debe aplicar pago y disparar reactivación', async () => {
      mockRepo.findById
        .mockResolvedValueOnce({ ...mockPago, estado: EstadoPago.PENDIENTE_VERIFICACION }) // antes
        .mockResolvedValueOnce({ ...mockPago, estado: EstadoPago.VERIFICADO });             // después update
      mockRepo.update.mockResolvedValue(undefined);
      mockFacturacionSvc.aplicarPago.mockResolvedValue(undefined);
      mockRepo.calcularDeudaContrato.mockResolvedValue({ deuda: 0, meses: 0 });
      mockContratosSvc.actualizarDeuda.mockResolvedValue(undefined);
      mockContratosSvc.findOne.mockResolvedValue(mockContratoSuspendido);
      mockContratosSvc.cambiarEstado.mockResolvedValue({ ...mockContratoSuspendido, estado: EstadoContrato.ACTIVO });
      mockDs.query.mockResolvedValue([{ contrato_id: 'cnt-001' }]);

      await service.verificar('pag-001', { aprobado: true }, mockUser as any);

      // El contrato estaba SUSPENDIDO_MORA y la deuda quedó en 0 → debe reactivarse
      expect(mockContratosSvc.cambiarEstado).toHaveBeenCalledWith(
        'cnt-001',
        expect.objectContaining({ estado: EstadoContrato.ACTIVO }),
        expect.anything(),
        true, // automatico
      );
    });

    it('al rechazar debe guardar motivo y NO aplicar pago', async () => {
      mockRepo.findById.mockResolvedValue({ ...mockPago, estado: EstadoPago.PENDIENTE_VERIFICACION });
      mockRepo.update.mockResolvedValue(undefined);

      await service.verificar('pag-001', {
        aprobado: false,
        motivoRechazo: 'Número de operación no coincide con el sistema del banco',
      }, mockUser as any);

      expect(mockRepo.update).toHaveBeenCalledWith('pag-001', expect.objectContaining({
        estado:        EstadoPago.RECHAZADO,
        motivoRechazo: expect.stringContaining('no coincide'),
      }));
      expect(mockFacturacionSvc.aplicarPago).not.toHaveBeenCalled();
    });

    it('debe requerir motivo al rechazar', async () => {
      mockRepo.findById.mockResolvedValue({ ...mockPago, estado: EstadoPago.PENDIENTE_VERIFICACION });
      await expect(service.verificar('pag-001', { aprobado: false }, mockUser as any))
        .rejects.toThrow(BadRequestException);
    });

    it('no debe verificar un pago ya verificado', async () => {
      mockRepo.findById.mockResolvedValue({ ...mockPago, estado: EstadoPago.VERIFICADO });
      await expect(service.verificar('pag-001', { aprobado: true }, mockUser as any))
        .rejects.toThrow(BadRequestException);
    });
  });

  // ── Reactivación automática ────────────────────────────────
  describe('reactivación automática', () => {

    it('NO reactiva si el contrato ya está activo', async () => {
      mockRepo.findById
        .mockResolvedValueOnce({ ...mockPago, estado: EstadoPago.PENDIENTE_VERIFICACION })
        .mockResolvedValueOnce({ ...mockPago, estado: EstadoPago.VERIFICADO });
      mockRepo.update.mockResolvedValue(undefined);
      mockFacturacionSvc.aplicarPago.mockResolvedValue(undefined);
      mockRepo.calcularDeudaContrato.mockResolvedValue({ deuda: 0, meses: 0 });
      mockContratosSvc.actualizarDeuda.mockResolvedValue(undefined);
      // Contrato ya está ACTIVO
      mockContratosSvc.findOne.mockResolvedValue(mockContratoActivo);
      mockDs.query.mockResolvedValue([{ contrato_id: 'cnt-001' }]);

      await service.verificar('pag-001', { aprobado: true }, mockUser as any);

      // No debe llamar cambiarEstado porque el contrato ya está activo
      expect(mockContratosSvc.cambiarEstado).not.toHaveBeenCalled();
    });

    it('NO reactiva si aún queda deuda después del pago parcial', async () => {
      mockRepo.findById
        .mockResolvedValueOnce({ ...mockPago, estado: EstadoPago.PENDIENTE_VERIFICACION, monto: 40 })
        .mockResolvedValueOnce({ ...mockPago, estado: EstadoPago.VERIFICADO, monto: 40 });
      mockRepo.update.mockResolvedValue(undefined);
      mockFacturacionSvc.aplicarPago.mockResolvedValue(undefined);
      // Aún queda deuda
      mockRepo.calcularDeudaContrato.mockResolvedValue({ deuda: 45, meses: 1 });
      mockContratosSvc.actualizarDeuda.mockResolvedValue(undefined);
      mockDs.query.mockResolvedValue([{ contrato_id: 'cnt-001' }]);

      await service.verificar('pag-001', { aprobado: true }, mockUser as any);

      expect(mockContratosSvc.cambiarEstado).not.toHaveBeenCalled();
    });
  });

  // ── Conciliar ─────────────────────────────────────────────
  describe('conciliar()', () => {

    it('concilia pago verificado', async () => {
      mockRepo.findById.mockResolvedValue({ ...mockPago, estado: EstadoPago.VERIFICADO, conciliado: false });
      mockRepo.update.mockResolvedValue(undefined);

      await service.conciliar('pag-001', { extractoBancoRef: 'BCP-2024-00123' }, mockUser as any);

      expect(mockRepo.update).toHaveBeenCalledWith('pag-001', expect.objectContaining({
        conciliado:       true,
        extractoBancoRef: 'BCP-2024-00123',
      }));
    });

    it('no concilia pago pendiente de verificación', async () => {
      mockRepo.findById.mockResolvedValue({ ...mockPago, estado: EstadoPago.PENDIENTE_VERIFICACION });
      await expect(service.conciliar('pag-001', { extractoBancoRef: 'ref' }, mockUser as any))
        .rejects.toThrow(BadRequestException);
    });
  });

  // ── Webhook MercadoPago ────────────────────────────────────
  describe('procesarWebhookMercadoPago()', () => {

    it('debe rechazar firma inválida', async () => {
      mockMpSvc.validarWebhookSignature.mockReturnValue(false);

      await expect(service.procesarWebhookMercadoPago(
        { type: 'payment', action: 'payment.created', data: { id: '123' } },
        Buffer.from('{}'),
        'firma-invalida',
        'req-id-001',
      )).rejects.toThrow(ForbiddenException);
    });

    it('debe ignorar webhooks que no son de tipo payment', async () => {
      mockMpSvc.validarWebhookSignature.mockReturnValue(true);

      await service.procesarWebhookMercadoPago(
        { type: 'merchant_order', action: 'updated', data: { id: '123' } },
        Buffer.from('{}'),
        'sig',
        'req-001',
      );

      expect(mockMpSvc.consultarPago).not.toHaveBeenCalled();
    });

    it('debe crear pago y reactivar contrato con pago aprobado', async () => {
      mockMpSvc.validarWebhookSignature.mockReturnValue(true);
      mockRepo.findByMpPaymentId.mockResolvedValue(null);
      mockMpSvc.consultarPago.mockResolvedValue({
        id: 123456, status: 'approved', status_detail: 'accredited',
        transaction_amount: 85, currency_id: 'PEN',
        external_reference: 'fac-001',
        payment_method_id: 'yape',
      });
      mockMpSvc.esAprobado.mockReturnValue(true);
      mockDs.query.mockResolvedValue([{
        empresa_id: 'emp-001', cliente_id: 'cli-001', contrato_id: 'cnt-001',
        total: 85, saldo: 85,
      }]);
      mockRepo.save.mockResolvedValue({ ...mockPago, estado: EstadoPago.VERIFICADO });
      mockFacturacionSvc.aplicarPago.mockResolvedValue(undefined);
      mockRepo.calcularDeudaContrato.mockResolvedValue({ deuda: 0, meses: 0 });
      mockContratosSvc.actualizarDeuda.mockResolvedValue(undefined);
      mockContratosSvc.findOne.mockResolvedValue(mockContratoSuspendido);
      mockContratosSvc.cambiarEstado.mockResolvedValue({ ...mockContratoSuspendido, estado: EstadoContrato.ACTIVO });

      await service.procesarWebhookMercadoPago(
        { type: 'payment', action: 'payment.created', data: { id: '123456' } },
        Buffer.from('{}'),
        'valid-sig',
        'req-001',
      );

      expect(mockRepo.save).toHaveBeenCalled();
      expect(mockFacturacionSvc.aplicarPago).toHaveBeenCalled();
    });
  });
});
