import { Rol } from './rol.entity';
export declare class Permiso {
    id: string;
    codigo: string;
    nombre: string;
    descripcion: string;
    modulo: string;
    createdAt: Date;
    roles: Rol[];
}
