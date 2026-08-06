import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException, NotFoundException,
  BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { EventEmitter2 }      from '@nestjs/event-emitter';
import { getQueueToken }      from '@nestjs/bull';
import { QUEUES }             from '../workers/workers.constants';
import { WatcherHeartbeatService } from '../../common/services/watcher-heartbeat.service';
import { PagosService }        from './pagos.service';
import { PagoRepository }      from './repositories/pago.repository';
import { AdelantosService }     from './adelantos.service';
import { CanalPagoService }     from './canal-pago.service';
import { MercadoPagoService }  from './mercadopago.service';
import { FacturacionService }  from '../facturacion/facturacion.service';
import { DeudaPorContratoService } from '../facturacion/deuda-por-contrato.service';
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
  estado: EstadoContrato.SUSPENDIDO,
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

// `registrar()` pasó a ser TRANSACCIONAL (registrar un pago y aplicarlo a la factura
// tienen que ser atómicos o el dinero se pierde entre ambos pasos). El mock ejecuta el
// callback con un manager que delega en los mismos mocks, para que la transacción sea
// transparente al test en vez de tener que simularla en cada caso.
// `registrar()` pasó a ser TRANSACCIONAL (registrar el pago y aplicarlo a la factura
// tienen que ser atómicos, o el dinero se pierde entre ambos pasos) y resuelve todo por
// `manager.findOne(Entidad, …)`. El mock despacha POR ENTIDAD para que cada test controle
// qué existe: duplicado, factura y contrato son decisiones distintas del flujo.
const mockEntidades: {
  pagoDuplicado: any; factura: any; contrato: any; facturas: any[] | null;
} = {
  pagoDuplicado: null,
  factura:       null,
  contrato:      null,
  // Consolidado: `registrar()` resuelve los comprobantes con `find`, no con `findOne`.
  // Cuando es null se devuelve `[factura]`, que es el caso de un solo comprobante.
  facturas:      null,
};

const managerMock = {
  findOne: jest.fn(async (entidad: any) => {
    const nombre = entidad?.name ?? '';
    if (nombre === 'Pago')     return mockEntidades.pagoDuplicado;
    if (nombre === 'Factura')  return mockEntidades.factura;
    if (nombre === 'Contrato') return mockEntidades.contrato;
    return null;
  }),
  find: jest.fn(async (entidad: any) => {
    const nombre = entidad?.name ?? '';
    if (nombre === 'Factura') {
      return mockEntidades.facturas ?? (mockEntidades.factura ? [mockEntidades.factura] : []);
    }
    return [];
  }),
  // Imputación pago→factura (`pago_aplicaciones`).
  insert: jest.fn(),
  save:   jest.fn(async (_e: any, d: any) => ({ ...mockPago, ...(d ?? {}) })),
  update: jest.fn(),
  create: jest.fn((_e: any, d: any) => ({ ...mockPago, ...(d ?? {}) })),
  // La factura se actualiza con SQL crudo dentro de la TX → forma [filas, rowCount].
  query:  jest.fn().mockResolvedValue([[{ id: 'fac-001' }], 1]),
};

const mockDs = {
  query: jest.fn().mockResolvedValue([mockFacturaRow]),
  transaction: jest.fn(async (cb: any) => cb(managerMock)),
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
        // Recalcula deuda_total tras el pago; aquí no se ejercita.
        { provide: DeudaPorContratoService, useValue: { recalcularPorCliente: jest.fn(), calcular: jest.fn() } },
        { provide: ContratosService,    useValue: mockContratosSvc },
        { provide: AuditoriaService,    useValue: mockAuditoria },
        { provide: ConfigService,       useValue: mockConfig },
        { provide: getDataSourceToken(), useValue: mockDs },
        // Dependencias que el servicio adquirió después de escribirse este spec. Sin
        // ellas Nest no puede instanciarlo y la suite ENTERA se cae — no un test suelto.
        // `emitAsync` además de `emit`: el servicio espera a los listeners para saber si
        // la reactivación se aplicó. Un mock sin él hacía fallar el pago entero.
        { provide: EventEmitter2,        useValue: { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) } },
        { provide: getQueueToken(QUEUES.COBRANZA), useValue: { add: jest.fn() } },
        // El doble EJECUTA la función, no solo la registra: si solo la registrara, el
        // watcher de reconciliación parecería no hacer nada y sus tests pasarían en falso.
        // Saldo a favor: el registro de adelantos consulta la deuda antes de admitirlos.
        { provide: AdelantosService, useValue: {
          assertSinDeuda: jest.fn(), saldoAFavor: jest.fn(), aplicarSaldoAFactura: jest.fn(),
        } },
        // Los tres ejes del ingreso (F1). Por defecto NO resuelve canal: es el escenario
        // del método legado que el catálogo todavía no cubre, y el cobro debe registrarse
        // igual — sin canal, pero registrado. Los tests del propio catálogo viven en
        // `canal-pago.service.spec.ts`.
        { provide: CanalPagoService, useValue: {
          porId:              jest.fn(),
          resolverDesdeLegacy: jest.fn().mockResolvedValue(null),
          calcularComision:   jest.fn((_c: unknown, monto: number) => ({ comision: 0, neto: monto })),
        } },
        { provide: WatcherHeartbeatService, useValue: {
          ejecutar: jest.fn(async (_n: string, _i: number, fn: any) => fn()),
        } },
      ],
    }).compile();
    service = m.get<PagosService>(PagosService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── Registrar pago ────────────────────────────────────────
  describe('registrar()', () => {

    // El flujo vive DENTRO de una transacción y resuelve todo con `manager.findOne`;
    // `mockEntidades` define qué encuentra: ese es el estado del mundo de cada caso.
    beforeEach(() => {
      mockEntidades.pagoDuplicado = null;
      mockEntidades.factura       = { ...mockFacturaRow, contratoId: 'cnt-001', clienteId: 'cli-001' };
      mockEntidades.contrato      = mockContratoSuspendido;
      mockEntidades.facturas      = null;
    });

    // ── Pago consolidado ────────────────────────────────────
    // Un abonado con dos comprobantes se cobraba en dos pagos, y el operador tenía que
    // repetir el número de operación en ambos — cosa que el índice único prohíbe. Se
    // resuelve con UN pago imputado a N facturas, no con N pagos que compartan código.
    describe('consolidado', () => {
      const dosFacturas = [
        { ...mockFacturaRow, id: 'fac-001', clienteId: 'cli-001', contratoId: 'cnt-001',
          total: 64, montoPagado: 0, saldo: 64, numeroCompleto: 'CI-033' },
        { ...mockFacturaRow, id: 'fac-002', clienteId: 'cli-001', contratoId: 'cnt-001',
          total: 64, montoPagado: 0, saldo: 64, numeroCompleto: 'CI-035' },
      ];

      it('salda los dos comprobantes con UN pago y UN número de operación', async () => {
        mockEntidades.facturas = dosFacturas;

        await service.registrar({
          clienteId: 'cli-001', facturaIds: ['fac-001', 'fac-002'],
          monto: 128, metodoPago: MetodoPago.EFECTIVO,
          numeroOperacion: 'OP-UNICA-1', autoVerificar: true,
        } as any, mockUser as any);

        // Una sola fila de pago: el dinero entró una vez.
        expect(managerMock.save).toHaveBeenCalledTimes(1);
        // Y dos imputaciones, una por comprobante.
        expect(managerMock.insert).toHaveBeenCalledTimes(2);
        const facturasImputadas = managerMock.insert.mock.calls.map((c: any[]) => c[1].facturaId);
        expect(facturasImputadas.sort()).toEqual(['fac-001', 'fac-002']);
      });

      it('rechaza un importe que no cubre el total: el consolidado es todo o nada', async () => {
        mockEntidades.facturas = dosFacturas;

        await expect(service.registrar({
          clienteId: 'cli-001', facturaIds: ['fac-001', 'fac-002'],
          monto: 100, metodoPago: MetodoPago.EFECTIVO,
          numeroOperacion: 'OP-PARCIAL', autoVerificar: true,
        } as any, mockUser as any)).rejects.toThrow(/debe cubrir el total/i);

        expect(managerMock.insert).not.toHaveBeenCalled();
      });

      it('no permite mezclar comprobantes de clientes distintos en un mismo pago', async () => {
        mockEntidades.facturas = [
          dosFacturas[0],
          { ...dosFacturas[1], clienteId: 'cli-OTRO' },
        ];

        await expect(service.registrar({
          clienteId: 'cli-001', facturaIds: ['fac-001', 'fac-002'],
          monto: 128, metodoPago: MetodoPago.EFECTIVO, autoVerificar: true,
        } as any, mockUser as any)).rejects.toThrow(/clientes distintos/i);
      });

      it('rechaza el consolidado si uno de los comprobantes ya está pagado', async () => {
        mockEntidades.facturas = [
          dosFacturas[0],
          { ...dosFacturas[1], estado: EstadoFactura.PAGADA },
        ];

        await expect(service.registrar({
          clienteId: 'cli-001', facturaIds: ['fac-001', 'fac-002'],
          monto: 128, metodoPago: MetodoPago.EFECTIVO, autoVerificar: true,
        } as any, mockUser as any)).rejects.toThrow(/ya está pagado/i);
      });

      it('un pago de un solo comprobante también deja su imputación registrada', async () => {
        await service.registrar({
          clienteId: 'cli-001', facturaId: 'fac-001',
          monto: 85, metodoPago: MetodoPago.EFECTIVO,
          numeroOperacion: 'OP-SIMPLE', autoVerificar: true,
        } as any, mockUser as any);

        expect(managerMock.insert).toHaveBeenCalledTimes(1);
      });
    });

    it('debe registrar pago Yape como PENDIENTE_VERIFICACION', async () => {
      // Yape sin OTP requiere verificación humana: no se da por bueno automáticamente.
      managerMock.save.mockResolvedValueOnce({ ...mockPago, estado: EstadoPago.PENDIENTE_VERIFICACION });

      const result = await service.registrar({
        clienteId: 'cli-001', facturaId: 'fac-001', contratoId: 'cnt-001',
        monto: 85, metodoPago: MetodoPago.YAPE, numeroOperacion: 'YAP12345678',
      } as any, mockUser as any);

      expect(result.estado).toBe(EstadoPago.PENDIENTE_VERIFICACION);
      expect(managerMock.save).toHaveBeenCalled();
      // La atomicidad es el punto: el pago y su aplicación no pueden separarse.
      expect(mockDs.transaction).toHaveBeenCalled();
    });

    it('debe rechazar duplicado por número de operación', async () => {
      // Idempotencia: el mismo número de operación no puede cobrarse dos veces.
      mockEntidades.pagoDuplicado = mockPago;

      await expect(service.registrar({
        clienteId: 'cli-001', facturaId: 'fac-001',
        monto: 85, metodoPago: MetodoPago.YAPE,
        numeroOperacion: 'YAP12345678',
      } as any, mockUser as any)).rejects.toThrow(ConflictException);
    });

    it('acepta Yape sin número de operación, pero SIN auto-verificar', async () => {
      // El servicio ya no exige `numeroOperacion` al registrar: la protección pasó de
      // ser una validación de formato a ser idempotencia real por (empresa, método,
      // operación) — ver el test de duplicado. Un pago sin número simplemente no puede
      // deduplicarse ni auto-verificarse, así que queda pendiente de revisión humana.
      managerMock.save.mockResolvedValueOnce({ ...mockPago, numeroOperacion: null });

      const result = await service.registrar({
        clienteId: 'cli-001', facturaId: 'fac-001',
        monto: 85, metodoPago: MetodoPago.YAPE,
      } as any, mockUser as any);

      expect(result.estado).toBe(EstadoPago.PENDIENTE_VERIFICACION);
    });

    it('no registra un pago sobre una factura ya pagada', async () => {
      mockEntidades.factura = { ...mockFacturaRow, estado: EstadoFactura.PAGADA };

      await expect(service.registrar({
        clienteId: 'cli-001', facturaId: 'fac-001',
        monto: 85, metodoPago: MetodoPago.EFECTIVO,
      } as any, mockUser as any)).rejects.toThrow(BadRequestException);
    });

    it('un cajero SIN permiso no puede auto-verificar aunque lo pida', async () => {
      // Protección de caja: `autoVerificar: true` en el body no basta — exige rol
      // Administrador o el permiso `pagos:autoverificar`. Si el body pudiera decidirlo,
      // cualquiera daría por cobrado un pago que nadie recibió.
      managerMock.save.mockResolvedValueOnce({ ...mockPago, estado: EstadoPago.PENDIENTE_VERIFICACION });

      const result = await service.registrar({
        clienteId: 'cli-001', facturaId: 'fac-001', contratoId: 'cnt-001',
        monto: 85, metodoPago: MetodoPago.EFECTIVO, autoVerificar: true,
      } as any, mockUser as any); // mockUser = Cajero, sin ese permiso

      expect(result.estado).toBe(EstadoPago.PENDIENTE_VERIFICACION);
    });

    it('con permiso, auto-verifica y aplica el pago a la factura en la MISMA transacción', async () => {
      const usuarioAutorizado = { ...mockUser, roles: ['Administrador'] };
      const pagoVerificado = { ...mockPago, estado: EstadoPago.VERIFICADO, metodoPago: MetodoPago.EFECTIVO };
      managerMock.save.mockResolvedValueOnce(pagoVerificado);
      mockRepo.findById.mockResolvedValue(pagoVerificado);
      mockRepo.calcularDeudaContrato.mockResolvedValue({ deuda: 0, meses: 0 });
      mockContratosSvc.actualizarDeuda.mockResolvedValue(undefined);
      mockContratosSvc.findOne.mockResolvedValue(mockContratoActivo);

      const result = await service.registrar({
        clienteId: 'cli-001', facturaId: 'fac-001', contratoId: 'cnt-001',
        monto: 85, metodoPago: MetodoPago.EFECTIVO, autoVerificar: true,
      } as any, usuarioAutorizado as any);

      expect(result.estado).toBe(EstadoPago.VERIFICADO);

      // La factura se actualiza DENTRO de la transacción, no delegando en
      // FacturacionService: cobrar y aplicar tienen que ser un solo hecho, o el dinero
      // queda registrado sin imputar si algo falla en medio.
      const sqls = managerMock.query.mock.calls.map((c: any[]) => String(c[0]));
      expect(sqls.some((s) => /UPDATE\s+facturas/i.test(s))).toBe(true);
      expect(mockDs.transaction).toHaveBeenCalled();
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

    // "Solo registrar": el abonado se da de baja y paga su último comprobante. Saldar la
    // deuda disparaba la reactivación y el ERP le devolvía el servicio a alguien que se
    // está yendo. La decisión se toma al cobrar y se respeta al verificar, que puede ser
    // días después y por otra persona.
    it('NO reactiva cuando el pago se registró como "Solo registrar" (baja voluntaria)', async () => {
      mockRepo.findById
        .mockResolvedValueOnce({
          ...mockPago, estado: EstadoPago.PENDIENTE_VERIFICACION, reactivarServicio: false,
        })
        .mockResolvedValueOnce({
          ...mockPago, estado: EstadoPago.VERIFICADO, reactivarServicio: false,
        });
      mockRepo.update.mockResolvedValue(undefined);
      mockFacturacionSvc.aplicarPago.mockResolvedValue(undefined);
      // El contrato SÍ está suspendido y la deuda queda en cero: sin la marca, este es
      // exactamente el caso en el que se reactivaría.
      mockContratosSvc.findOne.mockResolvedValue(mockContratoSuspendido);
      mockRepo.calcularDeudaContrato.mockResolvedValue({ deuda: 0, meses: 0 });
      mockDs.query.mockResolvedValue([{ contrato_id: 'cnt-001' }]);

      await service.verificar('pag-001', { aprobado: true }, mockUser as any);

      expect(mockContratosSvc.cambiarEstado).not.toHaveBeenCalled();
    });

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
