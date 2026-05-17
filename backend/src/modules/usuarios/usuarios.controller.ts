import {
  Controller, Get, Post, Put, Patch, Delete,
  Body, Param, Query, Req, HttpCode, HttpStatus,
  ParseUUIDPipe, ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';

import { UsuariosService }  from './usuarios.service';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { Roles }            from '../../common/decorators/roles.decorator';
import {
  CreateUsuarioDto, UpdateUsuarioDto, ResetPasswordDto,
  EstadoUsuarioDto, AsignarRolesDto,
} from './dto/usuario.dto';
import {
  CreateRolDto, UpdateRolDto, AsignarPermisosDto,
} from './dto/rol.dto';
import { IsString, IsNotEmpty } from 'class-validator';

class ClonarRolDto {
  @IsString() @IsNotEmpty() nuevoNombre: string;
}

// ──────────────────────────────────────────────────────────────
// USUARIOS
// ──────────────────────────────────────────────────────────────
@ApiTags('Usuarios')
@ApiBearerAuth('JWT')
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly svc: UsuariosService) {}

  @Get()
  @Roles('Administrador', 'Supervisor', 'Super Administrador')
  @ApiOperation({ summary: 'Listar usuarios del sistema' })
  listar(@CurrentUser() user: JwtPayload) {
    return this.svc.listarUsuarios(user.empresaId);
  }

  @Get(':id')
  @Roles('Administrador', 'Supervisor', 'Super Administrador')
  obtener(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.svc.obtenerUsuario(id, user.empresaId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('Administrador', 'Super Administrador')
  @ApiOperation({ summary: 'Crear usuario' })
  crear(@Body() dto: CreateUsuarioDto, @CurrentUser() user: JwtPayload) {
    return this.svc.crearUsuario(user.empresaId, dto, user.email);
  }

  @Put(':id')
  @Roles('Administrador', 'Super Administrador')
  actualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUsuarioDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.svc.actualizarUsuario(id, user.empresaId, dto, user.email);
  }

  @Patch(':id/estado')
  @Roles('Administrador', 'Super Administrador')
  @ApiOperation({ summary: 'Cambiar estado activo/inactivo/bloqueado' })
  cambiarEstado(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EstadoUsuarioDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.svc.cambiarEstado(id, user.empresaId, dto, user.email);
  }

  @Patch(':id/roles')
  @Roles('Administrador', 'Super Administrador')
  @ApiOperation({ summary: 'Asignar roles al usuario' })
  asignarRoles(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AsignarRolesDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.svc.asignarRoles(id, user.empresaId, dto, user.email);
  }

  @Patch(':id/reset-password')
  @Roles('Administrador', 'Super Administrador')
  @ApiOperation({ summary: 'Restablecer contraseña de usuario' })
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.svc.resetPassword(id, user.empresaId, dto, user.email);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('Administrador', 'Super Administrador')
  @ApiOperation({ summary: 'Eliminar usuario (soft delete)' })
  eliminar(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.svc.eliminarUsuario(id, user.empresaId, user.email);
  }
}

// ──────────────────────────────────────────────────────────────
// ROLES
// ──────────────────────────────────────────────────────────────
@ApiTags('Usuarios')
@ApiBearerAuth('JWT')
@Controller('roles')
export class RolesController {
  constructor(private readonly svc: UsuariosService) {}

  @Get()
  @Roles('Administrador', 'Supervisor', 'Super Administrador')
  @ApiOperation({ summary: 'Listar roles con sus permisos' })
  listar(@CurrentUser() user: JwtPayload) {
    return this.svc.listarRoles(user.empresaId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('Administrador', 'Super Administrador')
  @ApiOperation({ summary: 'Crear rol' })
  crear(@Body() dto: CreateRolDto, @CurrentUser() user: JwtPayload) {
    return this.svc.crearRol(user.empresaId, dto, user.email);
  }

  @Put(':id')
  @Roles('Administrador', 'Super Administrador')
  actualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRolDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.svc.actualizarRol(id, user.empresaId, dto, user.email);
  }

  @Patch(':id/permisos')
  @Roles('Administrador', 'Super Administrador')
  @ApiOperation({ summary: 'Asignar permisos a un rol' })
  asignarPermisos(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AsignarPermisosDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.svc.asignarPermisosARol(id, user.empresaId, dto, user.email);
  }

  @Post(':id/clonar')
  @HttpCode(HttpStatus.CREATED)
  @Roles('Administrador', 'Super Administrador')
  @ApiOperation({ summary: 'Clonar un rol existente' })
  clonar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ClonarRolDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.svc.clonarRol(id, user.empresaId, dto.nuevoNombre, user.email);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('Administrador', 'Super Administrador')
  @ApiOperation({ summary: 'Eliminar rol (no aplica si tiene usuarios asignados)' })
  eliminar(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.svc.eliminarRol(id, user.empresaId, user.email);
  }
}

// ──────────────────────────────────────────────────────────────
// PERMISOS (solo lectura)
// ──────────────────────────────────────────────────────────────
@ApiTags('Usuarios')
@ApiBearerAuth('JWT')
@Controller('permisos')
export class PermisosController {
  constructor(private readonly svc: UsuariosService) {}

  @Get()
  @Roles('Administrador', 'Supervisor', 'Super Administrador')
  @ApiOperation({ summary: 'Listar todos los permisos agrupados por módulo' })
  listar() {
    return this.svc.listarPermisos();
  }
}

// ──────────────────────────────────────────────────────────────
// LOGS DE AUDITORÍA
// ──────────────────────────────────────────────────────────────
@ApiTags('Usuarios')
@ApiBearerAuth('JWT')
@Controller('personal/logs')
export class PersonalLogsController {
  constructor(private readonly svc: UsuariosService) {}

  @Get()
  @Roles('Administrador', 'Supervisor', 'Super Administrador')
  @ApiOperation({ summary: 'Logs de actividad del personal' })
  listar(
    @CurrentUser() user: JwtPayload,
    @Query('limit') limit?: string,
  ) {
    return this.svc.listarLogs(user.empresaId, limit ? parseInt(limit, 10) : 100);
  }
}
