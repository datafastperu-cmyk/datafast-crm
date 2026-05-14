import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

import { AuthService } from './auth.service';
import { AuditoriaService } from './auditoria.service';
import { Usuario, EstadoUsuario } from '../usuarios/entities/usuario.entity';
import * as bcrypt from 'bcryptjs';

// ── Mocks ─────────────────────────────────────────────────────
const mockUsuario: Partial<Usuario> = {
  id: 'uuid-test-001',
  empresaId: 'empresa-001',
  nombres: 'Admin',
  apellidos: 'Test',
  email: 'admin@test.pe',
  passwordHash: '',
  estado: EstadoUsuario.ACTIVO,
  emailVerificado: true,
  intentosFallidos: 0,
  bloqueadoHasta: null,
  refreshTokenHash: null,
  tema: 'dark',
  roles: [
    {
      id: 'rol-001',
      nombre: 'Administrador',
      permisos: [{ codigo: 'clientes:create', nombre: 'Crear clientes' }],
      codigosPermisos: ['clientes:create'],
    } as any,
  ],
  get nombreCompleto() { return 'Admin Test'; },
  get nombresRoles() { return ['Administrador']; },
  get permisos() { return ['clientes:create']; },
  get estaActivo() { return true; },
  get estaBloqueado() { return false; },
};

const mockCache = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
};

const mockUsuarioRepo = {
  findOne: jest.fn(),
  update: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
};

const mockAuditoria = {
  log: jest.fn(),
  logLogin: jest.fn(),
  logLogout: jest.fn(),
};

// ─────────────────────────────────────────────────────────────
// Tests del AuthService
// ─────────────────────────────────────────────────────────────
describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;

  beforeEach(async () => {
    const hash = await bcrypt.hash('Admin@Test123!', 12);
    mockUsuario.passwordHash = hash;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(Usuario),
          useValue: mockUsuarioRepo,
        },
        {
          provide: JwtService,
          useValue: {
            signAsync: jest.fn().mockResolvedValue('mock.jwt.token'),
            verify: jest.fn(),
            decode: jest.fn().mockReturnValue({ exp: Math.floor(Date.now()/1000) + 900 }),
          },
        },
        {
          provide: 'ConfigService',
          useValue: {
            get: jest.fn((key: string) => {
              const cfg = {
                'jwt.secret': 'test-secret',
                'jwt.refreshSecret': 'test-refresh-secret',
                'jwt.expiresIn': '15m',
                'jwt.refreshExpiresIn': '7d',
              };
              return cfg[key];
            }),
          },
        },
        { provide: AuditoriaService, useValue: mockAuditoria },
        { provide: CACHE_MANAGER, useValue: mockCache },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jwtService = module.get<JwtService>(JwtService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── Login exitoso ────────────────────────────────────────
  it('debe retornar tokens en login exitoso', async () => {
    mockUsuarioRepo.findOne.mockResolvedValue(mockUsuario);
    mockUsuarioRepo.update.mockResolvedValue({ affected: 1 });

    const mockReq = { ip: '127.0.0.1', get: jest.fn(), method: 'POST', path: '/auth/login' } as any;
    const result = await service.login(
      { email: 'admin@test.pe', password: 'Admin@Test123!' },
      mockReq,
    );

    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');
    expect(result).toHaveProperty('tokenType', 'Bearer');
    expect(result.usuario.email).toBe('admin@test.pe');
    expect(mockAuditoria.logLogin).toHaveBeenCalledWith(
      expect.objectContaining({ exitoso: true }),
    );
  });

  // ── Login fallido ────────────────────────────────────────
  it('debe lanzar 401 con credenciales inválidas', async () => {
    mockUsuarioRepo.findOne.mockResolvedValue(mockUsuario);
    mockUsuarioRepo.update.mockResolvedValue({ affected: 1 });

    const mockReq = { ip: '127.0.0.1', get: jest.fn(), method: 'POST', path: '/auth/login' } as any;

    await expect(
      service.login({ email: 'admin@test.pe', password: 'WrongPassword!' }, mockReq),
    ).rejects.toThrow();
  });

  // ── Usuario no existe ────────────────────────────────────
  it('debe lanzar 401 si el usuario no existe', async () => {
    mockUsuarioRepo.findOne.mockResolvedValue(null);
    const mockReq = { ip: '127.0.0.1', get: jest.fn(), method: 'POST', path: '/auth/login' } as any;

    await expect(
      service.login({ email: 'noexiste@test.pe', password: 'cualquier' }, mockReq),
    ).rejects.toThrow('Email o contraseña incorrectos');
  });

  // ── Cambiar contraseña ───────────────────────────────────
  it('debe cambiar contraseña correctamente', async () => {
    mockUsuarioRepo.findOne.mockResolvedValue(mockUsuario);
    mockUsuarioRepo.update.mockResolvedValue({ affected: 1 });
    const mockReq = { ip: '127.0.0.1', get: jest.fn() } as any;

    await expect(
      service.cambiarPassword(
        mockUsuario.id,
        mockUsuario.empresaId,
        {
          passwordActual: 'Admin@Test123!',
          passwordNuevo: 'NuevoPassword@456!',
          confirmarPassword: 'NuevoPassword@456!',
        },
        mockReq,
      ),
    ).resolves.not.toThrow();
  });
});
