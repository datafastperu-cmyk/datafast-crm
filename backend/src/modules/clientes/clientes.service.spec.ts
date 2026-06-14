import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { ClientesService } from './clientes.service';
import { ClienteRepository } from './repositories/cliente.repository';
import { ReniecService } from './reniec.service';
import { AuditoriaService } from '../auth/auditoria.service';
import { LicenciaService } from '../licencia/licencia.service';
import { ContratosService } from '../contratos/contratos.service';
import { EstadoCliente, TipoDocumento, TipoServicio } from './entities/cliente.entity';
import { EstadoContrato } from '../contratos/entities/contrato.entity';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';

// ── Mocks ─────────────────────────────────────────────────────
const mockUser = {
  sub: 'user-001', email: 'admin@test.pe',
  empresaId: 'empresa-001', roles: ['Administrador'],
  permisos: ['clientes:create'], nombreCompleto: 'Admin Test', tema: 'dark',
};

const mockCliente = {
  id: 'cli-001', empresaId: 'empresa-001',
  tipoDocumento: TipoDocumento.DNI, numeroDocumento: '12345678',
  nombres: 'Juan', apellidoPaterno: 'Pérez', apellidoMaterno: 'García',
  nombreCompleto: 'Juan Pérez García', email: 'juan@test.pe',
  telefono: '987654321', direccion: 'Av. Lima 123',
  estado: EstadoCliente.PENDIENTE_INSTALACION, tipoServicio: TipoServicio.FTTH,
  codigoCliente: 'CLI-20240101-1234',
  version: 1, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
  facturacionConfig: null, notificacionesConfig: null,
  whatsapp: null, passwordPortal: null,
};

const mockRepo = {
  create: jest.fn((d) => ({ ...mockCliente, ...d })),
  save: jest.fn(async (c) => ({ ...mockCliente, ...c })),
  findById: jest.fn(),
  findByDocumento: jest.fn(),
  findAllPaginated: jest.fn(),
  getResumenEstados: jest.fn(),
  findConUbicacion: jest.fn(),
  softDelete: jest.fn(),
  update: jest.fn(),
  existeDocumento: jest.fn(),
  existeCodigoCliente: jest.fn().mockResolvedValue(false),
  countByEmpresa: jest.fn().mockResolvedValue({ count: 0 }),
  guardarHistorial: jest.fn(),
  getHistorialEstados: jest.fn(),
  getEstadisticas: jest.fn(),
  findAllForExport: jest.fn(),
  buildFilterQuery: jest.fn(),
};

const mockReniec    = { consultarDni: jest.fn(), consultarRuc: jest.fn() };
const mockAuditoria = { log: jest.fn(), logCreate: jest.fn(), logUpdate: jest.fn(), logDelete: jest.fn() };
const mockConfig    = { get: jest.fn() };
const mockLicencia  = { verificarLimiteClientes: jest.fn().mockResolvedValue(undefined) };
const mockContratos = {
  create: jest.fn(),
  findByCliente: jest.fn().mockResolvedValue([]),
  findByClienteCompleto: jest.fn().mockResolvedValue([]),
  cambiarEstado: jest.fn(),
  remove: jest.fn(),
  desaprovisionarMikrotik: jest.fn(),
  eliminarDeAccessListAntena: jest.fn(),
};
const mockEvents     = { emit: jest.fn() };
const mockDataSource = { query: jest.fn().mockResolvedValue([]) };

// ─── Tests ────────────────────────────────────────────────────
describe('ClientesService', () => {
  let service: ClientesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientesService,
        { provide: ClienteRepository,   useValue: mockRepo },
        { provide: ReniecService,        useValue: mockReniec },
        { provide: AuditoriaService,     useValue: mockAuditoria },
        { provide: ConfigService,        useValue: mockConfig },
        { provide: LicenciaService,      useValue: mockLicencia },
        { provide: ContratosService,     useValue: mockContratos },
        { provide: EventEmitter2,        useValue: mockEvents },
        { provide: DataSource,           useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<ClientesService>(ClientesService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── Crear ────────────────────────────────────────────────
  describe('create()', () => {
    it('debe crear un cliente correctamente', async () => {
      mockRepo.existeDocumento.mockResolvedValue(false);
      mockRepo.save.mockResolvedValue(mockCliente);

      const dto = {
        tipoDocumento: TipoDocumento.DNI,
        numeroDocumento: '12345678',
        nombres: 'Juan',
        apellidoPaterno: 'Pérez',
        telefono: '987654321',
        direccion: 'Av. Lima 123',
      };

      const result = await service.create(dto as any, mockUser as any);
      expect(result).toHaveProperty('id');
      expect(mockRepo.guardarHistorial).toHaveBeenCalledWith(
        expect.objectContaining({ estadoNuevo: EstadoCliente.PENDIENTE_INSTALACION }),
      );
      expect(mockLicencia.verificarLimiteClientes).toHaveBeenCalledWith('empresa-001');
    });

    it('debe lanzar ConflictException si el documento ya existe', async () => {
      mockRepo.existeDocumento.mockResolvedValue(true);

      await expect(
        service.create(
          { tipoDocumento: TipoDocumento.DNI, numeroDocumento: '12345678', nombres: 'X', apellidoPaterno: 'Y', telefono: '000', direccion: 'A' } as any,
          mockUser as any,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('debe hashear passwordPortal si se provee', async () => {
      mockRepo.existeDocumento.mockResolvedValue(false);
      mockRepo.save.mockResolvedValue(mockCliente);

      const dto = {
        tipoDocumento: TipoDocumento.DNI,
        numeroDocumento: '12345678',
        nombres: 'Juan',
        telefono: '987654321',
        direccion: 'Av. Lima 123',
        passwordPortal: 'miPass123',
      };

      await service.create(dto as any, mockUser as any);
      const savedData = mockRepo.create.mock.calls[0][0];
      expect(savedData.passwordPortal).not.toBe('miPass123');
      expect(savedData.passwordPortal).toMatch(/^\$2[ab]\$\d+\$/);
    });
  });

  // ── Buscar uno ────────────────────────────────────────────
  describe('findOne()', () => {
    it('debe retornar el cliente si existe', async () => {
      mockRepo.findById.mockResolvedValue(mockCliente);
      const result = await service.findOne('cli-001', 'empresa-001');
      expect(result.id).toBe('cli-001');
    });

    it('debe lanzar NotFoundException si no existe', async () => {
      mockRepo.findById.mockResolvedValue(null);
      await expect(service.findOne('no-existe', 'empresa-001')).rejects.toThrow(NotFoundException);
    });
  });

  // ── Cambiar estado ────────────────────────────────────────
  describe('cambiarEstado()', () => {
    it('debe cambiar de PENDIENTE_INSTALACION a ACTIVO', async () => {
      mockRepo.findById
        .mockResolvedValueOnce({ ...mockCliente, estado: EstadoCliente.PENDIENTE_INSTALACION })
        .mockResolvedValueOnce({ ...mockCliente, estado: EstadoCliente.ACTIVO });
      mockRepo.update.mockResolvedValue(undefined);
      mockRepo.guardarHistorial.mockResolvedValue(undefined);

      const result = await service.cambiarEstado(
        'cli-001',
        { estado: EstadoCliente.ACTIVO, motivo: 'Instalación completada' },
        mockUser as any,
      );

      expect(mockRepo.guardarHistorial).toHaveBeenCalledWith(
        expect.objectContaining({
          estadoAnterior: EstadoCliente.PENDIENTE_INSTALACION,
          estadoNuevo: EstadoCliente.ACTIVO,
        }),
      );
    });

    it('debe lanzar BadRequestException para transición inválida', async () => {
      mockRepo.findById.mockResolvedValue({ ...mockCliente, estado: EstadoCliente.BAJA_DEFINITIVA });

      await expect(
        service.cambiarEstado('cli-001', { estado: EstadoCliente.ACTIVO }, mockUser as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe terminar contratos al pasar a BAJA_DEFINITIVA', async () => {
      const contratoActivo = { id: 'cont-001', estado: EstadoContrato.ACTIVO };
      mockRepo.findById
        .mockResolvedValueOnce({ ...mockCliente, estado: EstadoCliente.ACTIVO })
        .mockResolvedValueOnce({ ...mockCliente, estado: EstadoCliente.BAJA_DEFINITIVA });
      mockContratos.findByCliente.mockResolvedValue([contratoActivo]);
      mockContratos.cambiarEstado.mockResolvedValue(undefined);
      mockContratos.remove.mockResolvedValue(undefined);

      await service.cambiarEstado(
        'cli-001',
        { estado: EstadoCliente.BAJA_DEFINITIVA, motivo: 'Solicitud cliente' },
        mockUser as any,
      );

      expect(mockContratos.cambiarEstado).toHaveBeenCalledWith(
        'cont-001',
        expect.objectContaining({ estado: EstadoContrato.BAJA_DEFINITIVA }),
        mockUser,
        true,
      );
    });
  });

  // ── Eliminar ──────────────────────────────────────────────
  describe('remove()', () => {
    it('no debe eliminar un cliente activo', async () => {
      mockRepo.findById.mockResolvedValue({ ...mockCliente, estado: EstadoCliente.ACTIVO });

      await expect(service.remove('cli-001', mockUser as any)).rejects.toThrow(BadRequestException);
      expect(mockRepo.softDelete).not.toHaveBeenCalled();
    });

    it('debe eliminar un cliente en baja definitiva', async () => {
      mockRepo.findById.mockResolvedValue({ ...mockCliente, estado: EstadoCliente.BAJA_DEFINITIVA });
      mockRepo.softDelete.mockResolvedValue(undefined);
      mockDataSource.query.mockResolvedValue([]);

      await expect(service.remove('cli-001', mockUser as any)).resolves.not.toThrow();
      expect(mockRepo.softDelete).toHaveBeenCalledWith('cli-001', 'empresa-001');
    });
  });

  // ── bulkAction ────────────────────────────────────────────
  describe('bulkAction()', () => {
    it('debe procesar acciones en chunks y reportar ok/errors', async () => {
      mockRepo.findById
        .mockResolvedValueOnce({ ...mockCliente, estado: EstadoCliente.ACTIVO })
        .mockResolvedValueOnce({ ...mockCliente, estado: EstadoCliente.SUSPENDIDO })
        .mockResolvedValueOnce({ ...mockCliente, estado: EstadoCliente.ACTIVO })
        .mockResolvedValueOnce({ ...mockCliente, estado: EstadoCliente.SUSPENDIDO });

      const result = await service.bulkAction(
        { ids: ['cli-001', 'cli-002'], action: 'suspender', motivo: 'Prueba' },
        mockUser as any,
      );

      expect(result.total).toBe(2);
      expect(result.ok + result.errors).toBe(2);
    });
  });

  // ── Resumen ──────────────────────────────────────────────
  describe('getResumen()', () => {
    it('debe retornar estados y estadísticas', async () => {
      mockRepo.getResumenEstados.mockResolvedValue({ activo: 10, suspendido: 2 });
      mockRepo.getEstadisticas.mockResolvedValue({ totales: [], nuevosEsteMes: 3 });

      const result = await service.getResumen('empresa-001');
      expect(result).toHaveProperty('estados');
      expect(result).toHaveProperty('nuevosEsteMes');
    });
  });
});
