import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { ContratosService } from './contratos.service';
import { ContratoRepository } from './repositories/contrato.repository';
import { PlanesService } from '../planes/planes.service';
import { AuditoriaService } from '../auth/auditoria.service';
import { ConfigService } from '@nestjs/config';
import { EstadoContrato } from './entities/contrato.entity';
import { TipoQueue } from '../planes/entities/plan.entity';
import { getDataSourceToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WirelessService } from '../mikrotik/services/wireless.service';
import { RouterConnectionPool } from '../mikrotik/services/connection-pool.service';
import { PppoeService } from '../mikrotik/services/pppoe.service';
import { ArpService } from '../mikrotik/services/arp.service';
import { FirewallService } from '../mikrotik/services/firewall.service';
import { MikrotikService } from '../mikrotik/mikrotik.service';
import { SmartoltApiService } from '../smartolt/smartolt-api.service';
import { XuiLinesService } from '../xui/xui-lines.service';
import { SagaLogService } from '../sagas/saga-log.service';
import { OutboxRedService } from '../outbox-red/outbox-red.service';
import { PromesasPagoService } from '../promesas-pago/promesas-pago.service';
import { DeudaPorContratoService } from '../facturacion/deuda-por-contrato.service';
import { FacturacionService } from '../facturacion/facturacion.service';
import { PoliticaFacturacionService } from '../facturacion/politica-facturacion.service';

const mockUser = { sub:'u-001', email:'admin@test.pe', empresaId:'emp-001', roles:['Administrador'], permisos:[], nombreCompleto:'Admin', tema:'dark' };
const mockPlan = { id:'plan-001', empresaId:'emp-001', nombre:'Plan 30 Mbps', activo:true, precio:85.00, tipoQueue:TipoQueue.SIMPLE_QUEUE };
const mockContrato = { id:'cnt-001', empresaId:'emp-001', clienteId:'cli-001', planId:'plan-001', numeroContrato:'CNT-2024-000001', estado:EstadoContrato.PENDIENTE_ACTIVACION, ipAsignada:'192.168.1.2', segmentoId:'seg-001', deudaTotal:0, deletedAt:null };
const mockSegmento = { id:'seg-001', redCidr:'192.168.1.0/24', gateway:'192.168.1.1', ipsReservadas:['192.168.1.1'], activo:true };

const mockRepo = { create:jest.fn(d=>({...mockContrato,...d})), save:jest.fn(async c=>({...mockContrato,...c})), update:jest.fn(), findById:jest.fn(), findByClienteId:jest.fn(), softDelete:jest.fn(), findAllPaginated:jest.fn(), findCompleto:jest.fn(), findSegmento:jest.fn(), getIpsUsadas:jest.fn(), getIpsReservadas:jest.fn(), asignarIp:jest.fn(), liberarIp:jest.fn(), ipYaAsignada:jest.fn(), generarNumeroContrato:jest.fn(), guardarHistorial:jest.fn(), getHistorial:jest.fn(), findMorososParaCorte:jest.fn(), findParaReactivar:jest.fn(), findProrrogasVencidas:jest.fn(), getResumen:jest.fn() };
const mockPlanesSvc = { findOne:jest.fn() };
const mockAuditoria = { log:jest.fn(), logCreate:jest.fn(), logUpdate:jest.fn(), logDelete:jest.fn() };
const mockConfig = { get:jest.fn((k,d)=>d??1) };

// `create()` mezcla dos clases de consulta cruda: comprobaciones de EXISTENCIA (MAC ya
// registrada, usuario PPPoE en uso → deben devolver vacío para que el alta proceda) y
// AGREGADOS (conteos → deben devolver una fila o el servicio lee `undefined.total`).
// Un único valor para ambas hace que el alta se rechace por un duplicado inventado.
const filaAgregado = [{ total: '0', count: '0' }];
const mockDs = {
  query: jest.fn(async (sql: string) =>
    /COUNT\(|SUM\(|\bAS\s+total\b/i.test(String(sql)) ? filaAgregado : [],
  ),
  transaction: jest.fn(async (cb: any) => cb({ query: jest.fn().mockResolvedValue(filaAgregado) })),
  // El alta usa un QueryRunner explícito para poder hacer rollback si la provisión falla
  // a mitad: crear el contrato y reservar la IP tienen que ser un solo hecho.
  createQueryRunner: jest.fn(() => ({
    connect:            jest.fn(),
    startTransaction:   jest.fn(),
    commitTransaction:  jest.fn(),
    rollbackTransaction: jest.fn(),
    release:            jest.fn(),
    query:              jest.fn().mockResolvedValue(filaAgregado),
    manager: {
      save:   jest.fn(async (_e: any, d: any) => ({ ...mockContrato, ...(d ?? {}) })),
      create: jest.fn((_e: any, d: any) => ({ ...mockContrato, ...(d ?? {}) })),
      // Discrimina por PATRÓN de consulta, igual que `mockDs.query`. Devolver siempre
      // `filaAgregado` hacía que el chequeo de unicidad del usuario PPPoE —que corre dentro
      // de la transacción desde 2026-07-29— creyera que el usuario ya existe y rechazara
      // toda alta. Un mock que responde lo mismo a cualquier pregunta no modela nada.
      query:  jest.fn(async (sql: string) =>
        /COUNT\(|SUM\(|\bAS\s+total\b/i.test(String(sql)) ? filaAgregado : [],
      ),
      update: jest.fn(),
      findOne: jest.fn(async () => null),
      // La IP se asigna con bloqueo pesimista sobre el segmento, para serializar el
      // pool entre las instancias PM2: sin lock, dos altas simultáneas pueden entregar
      // la MISMA IP a dos clientes. De ahí el QueryBuilder con setLock.
      createQueryBuilder: jest.fn(() => ({
        setLock:  jest.fn().mockReturnThis(),
        where:    jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne:   jest.fn().mockResolvedValue(mockSegmento),
      })),
      find: jest.fn().mockResolvedValue([]),   // ninguna IP ocupada aún
    },
  })),
};

/**
 * Doble inerte: cualquier método devuelve una promesa vacía. Se usa para las
 * dependencias de infraestructura que este spec no ejercita — declararlas una por una con
 * su superficie completa sería ruido que envejece peor que el propio servicio.
 */
const dobleInerte = () =>
  new Proxy({} as Record<string | symbol, unknown>, {
    get: (destino, prop) => {
      // CRÍTICO: `then` debe seguir siendo undefined. Si el proxy responde a `then` con
      // una función, JS considera el objeto un "thenable" y cualquier `await` sobre él
      // queda esperando un resolve que nunca llega — el módulo de test no compila nunca
      // y todos los tests mueren por timeout del hook, sin pista de la causa real.
      if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined;
      if (typeof prop === 'symbol') return undefined;
      if (!(prop in destino)) destino[prop] = jest.fn().mockResolvedValue(undefined);
      return destino[prop];
    },
  });

describe('ContratosService', () => {
  let service: ContratosService;
  beforeEach(async () => {
    const m = await Test.createTestingModule({
      providers: [
        ContratosService,
        { provide: ContratoRepository, useValue: mockRepo },
        { provide: PlanesService,      useValue: mockPlanesSvc },
        { provide: AuditoriaService,   useValue: mockAuditoria },
        { provide: ConfigService,      useValue: mockConfig },
        // ContratosService orquesta el alta contra MikroTik, SmartOLT, IPTV y el outbox:
        // 13 dependencias que fue adquiriendo y que este spec nunca declaró. Faltando UNA,
        // Nest no lo instancia y la suite entera se cae — no un test suelto.
        //
        // Son dobles INERTES a propósito: estos tests cubren reglas de negocio puras
        // (asignación de IP, transiciones de estado, prórrogas). El hardware se prueba en
        // sus propios módulos; mezclarlo aquí haría la suite lenta y frágil.
        ...[
          WirelessService, RouterConnectionPool, PppoeService, ArpService,
          FirewallService, MikrotikService, SmartoltApiService, XuiLinesService,
          SagaLogService, OutboxRedService, PromesasPagoService,
          // Desde ADR-019 la reactivación manual no pone la deuda a cero: la recalcula
          // desde las facturas, con la única definición que hay.
          DeudaPorContratoService,

          // El primer comprobante del alta se emite aqui desde el 2026-08-09 (H-3). Su

          // comportamiento se cubre en comprobante-de-alta.spec.ts; aqui solo hace falta

          // que el grafo de dependencias resuelva.

          FacturacionService, PoliticaFacturacionService,
        ].map((token) => ({ provide: token, useValue: dobleInerte() })),
        { provide: getDataSourceToken(), useValue: mockDs },
        { provide: EventEmitter2,        useValue: { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) } },
      ],
    }).compile();
    service = m.get(ContratosService);
    // 30s: importar los tokens de MikrotikService/OutboxRedService arrastra su grafo de
    // módulos y ts-jest tiene que compilarlo la primera vez. Son segundos de compilación,
    // no de ejecución — el default de 5s del hook se queda corto y hace fallar TODOS los
    // tests con un mensaje de timeout que no dice nada del código que se está probando.
  }, 30_000);
  afterEach(()=>jest.clearAllMocks());

  describe('create()', () => {
    it('crea contrato y asigna IP automática', async () => {
      mockPlanesSvc.findOne.mockResolvedValue(mockPlan);
      mockRepo.findByClienteId.mockResolvedValue([]);
      mockRepo.generarNumeroContrato.mockResolvedValue('CNT-2024-000001');
      mockRepo.findSegmento.mockResolvedValue(mockSegmento);
      mockRepo.getIpsUsadas.mockResolvedValue(['192.168.1.1']);
      mockRepo.getIpsReservadas.mockResolvedValue(['192.168.1.1']);
      mockRepo.ipYaAsignada.mockResolvedValue(false);
      mockRepo.save.mockResolvedValue(mockContrato);
      mockRepo.asignarIp.mockResolvedValue({});
      const result = await service.create({ clienteId:'cli-001', planId:'plan-001', fechaInicio:'2024-01-15', segmentoId:'seg-001' } as any, mockUser as any);
      expect(result.numeroContrato).toBe('CNT-2024-000001');

      // La IP ya no se reserva con `repo.asignarIp` suelto: se hace dentro de un
      // QueryRunner con bloqueo pesimista sobre el segmento y commit explícito. Sin ese
      // lock, dos altas simultáneas en distintas instancias PM2 pueden entregar la MISMA
      // IP a dos clientes. Se verifica la transacción, que es lo que da la garantía.
      const qr = mockDs.createQueryRunner.mock.results[0].value;
      expect(qr.startTransaction).toHaveBeenCalled();
      expect(qr.manager.createQueryBuilder).toHaveBeenCalled();
      expect(qr.commitTransaction).toHaveBeenCalled();
    });

    it('rechaza plan inactivo', async () => {
      mockPlanesSvc.findOne.mockResolvedValue({ ...mockPlan, activo:false });
      await expect(service.create({ clienteId:'x', planId:'p', fechaInicio:'2024-01-01' } as any, mockUser as any)).rejects.toThrow(BadRequestException);
    });

    it('un cliente PUEDE tener otro contrato del mismo plan (segundo domicilio)', async () => {
      // La prohibición de repetir plan por cliente se retiró: un mismo cliente puede
      // contratar el mismo servicio en dos domicilios. Lo que el servicio sí garantiza es
      // que el usuario PPPoE no colisione — se le añade un sufijo. El test anterior
      // esperaba un ConflictException que ya nadie lanza.
      mockPlanesSvc.findOne.mockResolvedValue(mockPlan);
      mockRepo.findByClienteId.mockResolvedValue([
        { planId: 'plan-001', estado: EstadoContrato.ACTIVO, numeroContrato: 'CNT-2024-000001' },
      ]);
      mockRepo.generarNumeroContrato.mockResolvedValue('CNT-2024-000002');
      mockRepo.findSegmento.mockResolvedValue(mockSegmento);
      mockRepo.save.mockResolvedValue({ ...mockContrato, numeroContrato: 'CNT-2024-000002' });

      await expect(
        service.create({ clienteId:'cli-001', planId:'plan-001', fechaInicio:'2024-01-15', segmentoId:'seg-001' } as any, mockUser as any),
      ).resolves.toBeDefined();
    });
  });

  describe('cambiarEstado()', () => {
    it('PENDIENTE_ACTIVACION → ACTIVO', async () => {
      mockRepo.findById.mockResolvedValueOnce(mockContrato).mockResolvedValueOnce({ ...mockContrato, estado:EstadoContrato.ACTIVO });
      await service.cambiarEstado('cnt-001', { estado:EstadoContrato.ACTIVO }, mockUser as any);
      expect(mockRepo.update).toHaveBeenCalledWith('cnt-001', expect.objectContaining({ estado:EstadoContrato.ACTIVO }));
    });

    it('rechaza transición inválida (terminal → ACTIVO)', async () => {
      mockRepo.findById.mockResolvedValue({ ...mockContrato, estado:EstadoContrato.BAJA_DEFINITIVA });
      await expect(service.cambiarEstado('cnt-001', { estado:EstadoContrato.ACTIVO }, mockUser as any)).rejects.toThrow(BadRequestException);
    });

    it('libera IP en BAJA_DEFINITIVA', async () => {
      mockRepo.findById.mockResolvedValueOnce({ ...mockContrato, estado:EstadoContrato.ACTIVO }).mockResolvedValueOnce({ ...mockContrato, estado:EstadoContrato.BAJA_DEFINITIVA });
      await service.cambiarEstado('cnt-001', { estado:EstadoContrato.BAJA_DEFINITIVA, motivo:'Mudanza' }, mockUser as any);
      expect(mockRepo.liberarIp).toHaveBeenCalledWith('cnt-001');
    });
  });

  describe('otorgarProrroga()', () => {
    // La prórroga dejó de ser un par de campos en `contratos` y pasó a ser una PROMESA DE
    // PAGO con entidad propia (auditable, con vencimiento y revocación). Este método ya
    // solo delega; las validaciones —incluida la de fecha pasada— viven en
    // PromesasPagoService. Los tests anteriores seguían comprobando el modelo viejo:
    // esperaban un `update` con `enProrroga: true` que hoy nadie ejecuta.
    it('delega la prórroga en el servicio de promesas de pago', async () => {
      const promesasSvc = (service as any).promesasSvc;
      mockRepo.findById.mockResolvedValue({ ...mockContrato, estado: EstadoContrato.ACTIVO });
      const futuro = new Date(); futuro.setDate(futuro.getDate() + 15);
      const hasta = futuro.toISOString().split('T')[0];

      await service.otorgarProrroga('cnt-001', { prorrogaHasta: hasta, motivo: 'Acuerdo' } as any, mockUser as any);

      expect(promesasSvc.crear).toHaveBeenCalledWith(
        expect.objectContaining({ contratoId: 'cnt-001', fechaVencimiento: hasta, motivo: 'Acuerdo' }),
        expect.objectContaining({ empresaId: 'emp-001' }),
      );
    });

    it.todo('validación de fecha pasada — se movió a PromesasPagoService, se prueba allí');
  });

  describe('activar()', () => {
    // `activar()` dejó de ser un cambio de estado: hoy es una SAGA de 5 pasos
    // (saga-log → provisión MikroTik → PPPoE → queue → confirmación) con compensación.
    // Cubrirla aquí con dobles inertes daría cobertura FALSA: los mocks devolverían
    // éxito en cada paso y el test pasaría sin ejercitar nada de lo que puede fallar de
    // verdad — que es justamente la compensación cuando el hardware no responde.
    // Su sitio es un test de integración con la saga real; se deja constancia en vez de
    // fingir que está probada.
    it('la única validación previa que SÍ es lógica pura: rechaza un contrato no pendiente', async () => {
      mockRepo.findById.mockResolvedValue({ ...mockContrato, estado: EstadoContrato.ACTIVO });
      await expect(service.activar('cnt-001', mockUser as any)).rejects.toThrow(/PENDIENTE_ACTIVACION/i);
    });

    it.todo('saga completa de activación y su compensación — requiere test de integración');
  });
});
