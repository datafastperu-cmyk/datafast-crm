import { Module }              from '@nestjs/common';
import { TypeOrmModule }       from '@nestjs/typeorm';

import {
  UsuariosController, RolesController,
  PermisosController, PersonalLogsController,
} from './usuarios.controller';
import { UsuariosService }     from './usuarios.service';

import { Usuario }      from './entities/usuario.entity';
import { Rol }          from './entities/rol.entity';
import { Permiso }      from './entities/permiso.entity';
import { AuditoriaLog } from './entities/auditoria-log.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Usuario, Rol, Permiso, AuditoriaLog]),
  ],
  controllers: [
    UsuariosController,
    RolesController,
    PermisosController,
    PersonalLogsController,
  ],
  providers: [UsuariosService],
  exports:   [UsuariosService],
})
export class UsuariosModule {}
