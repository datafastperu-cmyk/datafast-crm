import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { ClientesService } from './clientes.service';
import { ClienteRepository } from './repositories/cliente.repository';
import { ReniecService } from './reniec.service';
import { AuditoriaService } from '../auth/auditoria.service';
import { EstadoCliente, TipoDocumento, TipoServicio } from './entities/cliente.entity';
import { ConfigService } from '@nestjs/config';

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
  estado: EstadoCliente.PROSPECTO, tipoServicio: TipoServicio.FTTH,
  createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
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
  guardarHistorial: jest.fn(),
  getHistorialEstados: jest.fn(),
  getEstadisticas: jest.fn(),
  findAllForExport: jest.fn(),
  buildFilterQuery: jest.fn(),
};

const mockReniec   = { consultarDni: jest.fn(), consultarRuc: jest.fn() };
const mockAuditoria = { log: jest.fn(), logCreate: jest.fn(), logUpdate: jest.fn(), logDelete: jest.fn() };
const mockConfig   = { get: jest.fn() };

// ─── Tests ────────────────────────────────────────────────────
describe('ClientesService', () => {
  let service: ClientesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientesService,
        { provide: ClienteRepository, useValue: mockRepo },
        { provide: ReniecService, useValue: mockReniec },
        { provide: AuditoriaService, useValue: mockAuditoria },
        { provide: ConfigService, useValue: mockConfig },
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
        expect.objectContaining({ estadoNuevo: EstadoCliente.PROSPECTO }),
      );
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
    it('debe cambiar de PROSPECTO a ACTIVO', async () => {
      mockRepo.findById.mockResolvedValue({ ...mockCliente, estado: EstadoCliente.PROSPECTO });
      mockRepo.update.mockResolvedValue(undefined);
      mockRepo.guardarHistorial.mockResolvedValue(undefined);

      // Segunda llamada de findOne retorna el estado actualizado
      mockRepo.findById
        .mockResolvedValueOnce({ ...mockCliente, estado: EstadoCliente.PROSPECTO })
        .mockResolvedValueOnce({ ...mockCliente, estado: EstadoCliente.ACTIVO });

      const result = await service.cambiarEstado(
        'cli-001',
        { estado: EstadoCliente.ACTIVO, motivo: 'Instalación completada' },
        mockUser as any,
      );

      expect(mockRepo.guardarHistorial).toHaveBeenCalledWith(
        expect.objectContaining({
          estadoAnterior: EstadoCliente.PROSPECTO,
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

      await expect(service.remove('cli-001', mockUser as any)).resolves.not.toThrow();
      expect(mockRepo.softDelete).toHaveBeenCalledWith('cli-001', 'empresa-001');
    });
  });
});
