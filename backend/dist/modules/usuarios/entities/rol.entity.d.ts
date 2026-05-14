import { BaseModel } from '../../../common/entities/base.entity';
import { Permiso } from './permiso.entity';
import { Usuario } from './usuario.entity';
export declare class Rol extends BaseModel {
    empresaId: string;
    nombre: string;
    descripcion: string;
    esSistema: boolean;
    permisos: Permiso[];
    usuarios: Usuario[];
    get codigosPermisos(): string[];
}
