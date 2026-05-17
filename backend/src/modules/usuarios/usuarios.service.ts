import {
  Injectable, Logger, NotFoundException, ConflictException,
  BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import * as nodemailer from 'nodemailer';
import { ConfigService } from '@nestjs/config';

import { Usuario, EstadoUsuario } from './entities/usuario.entity';
import { Rol }     from './entities/rol.entity';
import { Permiso } from './entities/permiso.entity';
import { AuditoriaLog } from './entities/auditoria-log.entity';
import {
  CreateUsuarioDto, UpdateUsuarioDto, ResetPasswordDto,
  EstadoUsuarioDto, AsignarRolesDto,
} from './dto/usuario.dto';
import { CreateRolDto, UpdateRolDto, AsignarPermisosDto } from './dto/rol.dto';

@Injectable()
export class UsuariosService {
  private readonly logger = new Logger(UsuariosService.name);

  constructor(
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    @InjectRepository(Rol)
    private readonly rolRepo: Repository<Rol>,
    @InjectRepository(Permiso)
    private readonly permisoRepo: Repository<Permiso>,
    @InjectRepository(AuditoriaLog)
    private readonly auditRepo: Repository<AuditoriaLog>,
    private readonly config: ConfigService,
  ) {}

  // ════════════════════════════════════════
  // USUARIOS — CRUD
  // ════════════════════════════════════════

  async listarUsuarios(empresaId: string) {
    const usuarios = await this.usuarioRepo.find({
      where: { empresaId },
      relations: ['roles', 'roles.permisos'],
      order: { createdAt: 'DESC' },
    });

    return usuarios.map((u) => this.toPublicUser(u));
  }

  async obtenerUsuario(id: string, empresaId: string) {
    const u = await this.usuarioRepo.findOne({
      where: { id, empresaId },
      relations: ['roles', 'roles.permisos'],
    });
    if (!u) throw new NotFoundException('Usuario no encontrado');
    return this.toPublicUser(u);
  }

  async crearUsuario(empresaId: string, dto: CreateUsuarioDto, actorEmail?: string) {
    const existe = await this.usuarioRepo.findOne({
      where: { email: dto.email.toLowerCase(), empresaId },
    });
    if (existe) throw new ConflictException('Ya existe un usuario con ese email');

    const roles = await this.resolverRoles(dto.roles, empresaId);
    const passwordHash = await bcrypt.hash(dto.password, 12);

    const nuevo = this.usuarioRepo.create({
      empresaId,
      nombres:      dto.nombres.trim(),
      apellidos:    dto.apellidos.trim(),
      email:        dto.email.toLowerCase(),
      telefono:     dto.telefono,
      passwordHash,
      estado:       EstadoUsuario.ACTIVO,
      emailVerificado: true,
      roles,
    });

    const guardado = await this.usuarioRepo.save(nuevo);

    this.auditLog(empresaId, 'CREATE_USER', actorEmail, `Usuario creado: ${dto.email}`);
    this.enviarEmailBienvenida(guardado, dto.password).catch(() => {});

    return this.toPublicUser(guardado);
  }

  async actualizarUsuario(id: string, empresaId: string, dto: UpdateUsuarioDto, actorEmail?: string) {
    const usuario = await this.usuarioRepo.findOne({ where: { id, empresaId } });
    if (!usuario) throw new NotFoundException('Usuario no encontrado');

    if (dto.email && dto.email !== usuario.email) {
      const otro = await this.usuarioRepo.findOne({
        where: { email: dto.email.toLowerCase(), empresaId, id: Not(id) },
      });
      if (otro) throw new ConflictException('Ese email ya está registrado');
      usuario.email = dto.email.toLowerCase();
    }

    if (dto.nombres)   usuario.nombres   = dto.nombres.trim();
    if (dto.apellidos) usuario.apellidos = dto.apellidos.trim();
    if (dto.telefono !== undefined) usuario.telefono = dto.telefono;

    if (dto.roles) {
      usuario.roles = await this.resolverRoles(dto.roles, empresaId);
    }

    await this.usuarioRepo.save(usuario);
    this.auditLog(empresaId, 'UPDATE_USER', actorEmail, `Usuario actualizado: ${id}`);

    return this.toPublicUser(
      await this.usuarioRepo.findOne({ where: { id }, relations: ['roles'] }),
    );
  }

  async cambiarEstado(id: string, empresaId: string, dto: EstadoUsuarioDto, actorEmail?: string) {
    const usuario = await this.usuarioRepo.findOne({ where: { id, empresaId } });
    if (!usuario) throw new NotFoundException('Usuario no encontrado');
    if (usuario.email === 'admin@datafast.pe') {
      throw new ForbiddenException('No se puede desactivar el usuario administrador principal');
    }

    usuario.estado = dto.estado as EstadoUsuario;
    if (dto.estado === 'activo') {
      usuario.intentosFallidos = 0;
      usuario.bloqueadoHasta = null;
    }
    await this.usuarioRepo.save(usuario);
    this.auditLog(empresaId, 'CHANGE_USER_STATUS', actorEmail, `Estado de ${id} → ${dto.estado}`);
    return { ok: true, estado: dto.estado };
  }

  async resetPassword(id: string, empresaId: string, dto: ResetPasswordDto, actorEmail?: string) {
    const usuario = await this.usuarioRepo.findOne({ where: { id, empresaId } });
    if (!usuario) throw new NotFoundException('Usuario no encontrado');

    usuario.passwordHash    = await bcrypt.hash(dto.nuevaPassword, 12);
    usuario.refreshTokenHash = null;
    usuario.intentosFallidos = 0;
    usuario.bloqueadoHasta   = null;
    await this.usuarioRepo.save(usuario);

    this.auditLog(empresaId, 'RESET_PASSWORD', actorEmail, `Contraseña restablecida para: ${id}`);
    this.enviarEmailCambioPassword(usuario, dto.nuevaPassword).catch(() => {});
    return { ok: true };
  }

  async asignarRoles(id: string, empresaId: string, dto: AsignarRolesDto, actorEmail?: string) {
    const usuario = await this.usuarioRepo.findOne({ where: { id, empresaId }, relations: ['roles'] });
    if (!usuario) throw new NotFoundException('Usuario no encontrado');

    usuario.roles = await this.resolverRoles(dto.roles, empresaId);
    await this.usuarioRepo.save(usuario);
    this.auditLog(empresaId, 'ASSIGN_ROLES', actorEmail, `Roles de ${id}: ${dto.roles.join(', ')}`);
    return this.toPublicUser(usuario);
  }

  async eliminarUsuario(id: string, empresaId: string, actorEmail?: string) {
    const usuario = await this.usuarioRepo.findOne({ where: { id, empresaId } });
    if (!usuario) throw new NotFoundException('Usuario no encontrado');
    if (usuario.email === 'admin@datafast.pe') {
      throw new ForbiddenException('No se puede eliminar el usuario administrador principal');
    }
    await this.usuarioRepo.softDelete(id);
    this.auditLog(empresaId, 'DELETE_USER', actorEmail, `Usuario eliminado: ${id}`);
    return { ok: true };
  }

  // ════════════════════════════════════════
  // ROLES — CRUD
  // ════════════════════════════════════════

  async listarRoles(empresaId: string) {
    const roles = await this.rolRepo.find({
      where: { empresaId },
      relations: ['permisos'],
      order: { nombre: 'ASC' },
    });
    return roles.map((r) => ({
      id:          r.id,
      nombre:      r.nombre,
      descripcion: r.descripcion,
      esSistema:   r.esSistema,
      permisos:    r.permisos?.map((p) => p.codigo) ?? [],
      totalPermisos: r.permisos?.length ?? 0,
      totalUsuarios: 0,
    }));
  }

  async crearRol(empresaId: string, dto: CreateRolDto, actorEmail?: string) {
    const existe = await this.rolRepo.findOne({ where: { nombre: dto.nombre, empresaId } });
    if (existe) throw new ConflictException('Ya existe un rol con ese nombre');

    const permisos = dto.permisosCodigos?.length
      ? await this.permisoRepo.findBy(dto.permisosCodigos.map((c) => ({ codigo: c })))
      : [];

    const rol = this.rolRepo.create({
      empresaId,
      nombre:      dto.nombre.trim(),
      descripcion: dto.descripcion,
      esSistema:   false,
      permisos,
    });

    const guardado = await this.rolRepo.save(rol);
    this.auditLog(empresaId, 'CREATE_ROL', actorEmail, `Rol creado: ${dto.nombre}`);
    return guardado;
  }

  async actualizarRol(id: string, empresaId: string, dto: UpdateRolDto, actorEmail?: string) {
    const rol = await this.rolRepo.findOne({ where: { id, empresaId }, relations: ['permisos'] });
    if (!rol) throw new NotFoundException('Rol no encontrado');

    if (dto.nombre && dto.nombre !== rol.nombre) {
      const otro = await this.rolRepo.findOne({ where: { nombre: dto.nombre, empresaId } });
      if (otro) throw new ConflictException('Ya existe un rol con ese nombre');
      rol.nombre = dto.nombre.trim();
    }
    if (dto.descripcion !== undefined) rol.descripcion = dto.descripcion;
    if (dto.permisosCodigos !== undefined) {
      rol.permisos = await this.permisoRepo.findBy(dto.permisosCodigos.map((c) => ({ codigo: c })));
    }

    await this.rolRepo.save(rol);
    this.auditLog(empresaId, 'UPDATE_ROL', actorEmail, `Rol actualizado: ${id}`);
    return rol;
  }

  async asignarPermisosARol(id: string, empresaId: string, dto: AsignarPermisosDto, actorEmail?: string) {
    const rol = await this.rolRepo.findOne({ where: { id, empresaId } });
    if (!rol) throw new NotFoundException('Rol no encontrado');

    rol.permisos = dto.permisosCodigos.length
      ? await this.permisoRepo.findBy(dto.permisosCodigos.map((c) => ({ codigo: c })))
      : [];

    await this.rolRepo.save(rol);
    this.auditLog(empresaId, 'ASSIGN_PERMISOS', actorEmail, `Permisos de rol ${id} actualizados`);
    return { ok: true, permisos: dto.permisosCodigos };
  }

  async clonarRol(id: string, empresaId: string, nuevoNombre: string, actorEmail?: string) {
    const origen = await this.rolRepo.findOne({ where: { id, empresaId }, relations: ['permisos'] });
    if (!origen) throw new NotFoundException('Rol origen no encontrado');
    const existe = await this.rolRepo.findOne({ where: { nombre: nuevoNombre, empresaId } });
    if (existe) throw new ConflictException('Ya existe un rol con ese nombre');

    const clon = this.rolRepo.create({
      empresaId,
      nombre:      nuevoNombre,
      descripcion: `Copia de ${origen.nombre}`,
      esSistema:   false,
      permisos:    origen.permisos,
    });
    const guardado = await this.rolRepo.save(clon);
    this.auditLog(empresaId, 'CLONE_ROL', actorEmail, `Rol clonado: ${origen.nombre} → ${nuevoNombre}`);
    return guardado;
  }

  async eliminarRol(id: string, empresaId: string, actorEmail?: string) {
    const rol = await this.rolRepo.findOne({ where: { id, empresaId } });
    if (!rol) throw new NotFoundException('Rol no encontrado');
    if (rol.esSistema) throw new ForbiddenException('No se puede eliminar un rol del sistema');

    await this.rolRepo.softDelete(id);
    this.auditLog(empresaId, 'DELETE_ROL', actorEmail, `Rol eliminado: ${id}`);
    return { ok: true };
  }

  // ════════════════════════════════════════
  // PERMISOS — lectura agrupada por módulo
  // ════════════════════════════════════════

  async listarPermisos() {
    const permisos = await this.permisoRepo.find({ order: { modulo: 'ASC', codigo: 'ASC' } });

    const grupos: Record<string, typeof permisos> = {};
    for (const p of permisos) {
      if (!grupos[p.modulo]) grupos[p.modulo] = [];
      grupos[p.modulo].push(p);
    }

    return Object.entries(grupos).map(([modulo, items]) => ({
      modulo,
      permisos: items.map((p) => ({ id: p.id, codigo: p.codigo, nombre: p.nombre, descripcion: p.descripcion })),
    }));
  }

  // ════════════════════════════════════════
  // LOGS DE AUDITORÍA
  // ════════════════════════════════════════

  async listarLogs(empresaId: string, limit = 100) {
    return this.auditRepo.find({
      where: { empresaId },
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 500),
    });
  }

  // ════════════════════════════════════════
  // HELPERS PRIVADOS
  // ════════════════════════════════════════

  private async resolverRoles(nombres: string[], empresaId: string): Promise<Rol[]> {
    if (!nombres.length) return [];
    const roles: Rol[] = [];
    for (const nombre of nombres) {
      const rol = await this.rolRepo.findOne({ where: { nombre, empresaId } });
      if (rol) roles.push(rol);
    }
    return roles;
  }

  private toPublicUser(u: Usuario | null) {
    if (!u) return null;
    return {
      id:             u.id,
      nombres:        u.nombres,
      apellidos:      u.apellidos,
      nombreCompleto: u.nombreCompleto,
      email:          u.email,
      telefono:       u.telefono,
      fotoUrl:        u.fotoUrl,
      estado:         u.estado,
      emailVerificado: u.emailVerificado,
      roles:          u.roles?.map((r) => r.nombre) ?? [],
      ultimoAcceso:   u.ultimoAcceso,
      createdAt:      u.createdAt,
    };
  }

  private auditLog(empresaId: string, accion: string, actorEmail?: string, descripcion?: string) {
    this.auditRepo.save(
      this.auditRepo.create({ empresaId, usuarioEmail: actorEmail, accion, modulo: 'personal', descripcion }),
    ).catch(() => {});
  }

  // ── Email helpers (opcionales — fallan silenciosamente si SMTP no está configurado) ──

  private async getMailTransport() {
    const host = this.config.get<string>('MAIL_HOST') || this.config.get<string>('SMTP_HOST');
    if (!host) return null;
    return nodemailer.createTransport({
      host,
      port:   this.config.get<number>('MAIL_PORT') || 587,
      secure: this.config.get<boolean>('MAIL_SECURE') || false,
      auth: {
        user: this.config.get<string>('MAIL_USER') || this.config.get<string>('SMTP_USER'),
        pass: this.config.get<string>('MAIL_PASS') || this.config.get<string>('SMTP_PASS'),
      },
    });
  }

  private async enviarEmailBienvenida(usuario: Usuario, passwordPlano: string): Promise<void> {
    const transport = await this.getMailTransport();
    if (!transport) return;

    const appUrl = this.config.get<string>('app.frontendUrl') || this.config.get<string>('FRONTEND_URL') || '';
    const from   = this.config.get<string>('MAIL_FROM') || 'noreply@datafast.pe';

    await transport.sendMail({
      from,
      to:      usuario.email,
      subject: 'Bienvenido a CRM DATAFAST — Acceso al sistema',
      html: `
        <h2>Bienvenido, ${usuario.nombres}</h2>
        <p>Tu cuenta en CRM ISP DATAFAST ha sido creada exitosamente.</p>
        <table>
          <tr><td><strong>Usuario:</strong></td><td>${usuario.email}</td></tr>
          <tr><td><strong>Contraseña:</strong></td><td>${passwordPlano}</td></tr>
          <tr><td><strong>Roles:</strong></td><td>${usuario.roles?.map((r) => r.nombre).join(', ')}</td></tr>
        </table>
        ${appUrl ? `<p><a href="${appUrl}">Iniciar sesión</a></p>` : ''}
        <p style="color:#999;font-size:12px">Por seguridad, cambia tu contraseña después del primer acceso.</p>
      `,
    });
  }

  private async enviarEmailCambioPassword(usuario: Usuario, passwordPlano: string): Promise<void> {
    const transport = await this.getMailTransport();
    if (!transport) return;

    const from = this.config.get<string>('MAIL_FROM') || 'noreply@datafast.pe';
    await transport.sendMail({
      from,
      to:      usuario.email,
      subject: 'CRM DATAFAST — Tu contraseña ha sido restablecida',
      html: `
        <h2>Restablecimiento de contraseña</h2>
        <p>Hola ${usuario.nombres},</p>
        <p>Tu contraseña en CRM ISP DATAFAST ha sido restablecida por un administrador.</p>
        <p><strong>Nueva contraseña temporal:</strong> ${passwordPlano}</p>
        <p style="color:#999;font-size:12px">Cambia esta contraseña al iniciar sesión.</p>
      `,
    });
  }
}
