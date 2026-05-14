import { BaseModel } from '../../../common/entities/base.entity';
import { Rol } from './rol.entity';
export declare enum EstadoUsuario {
    ACTIVO = "activo",
    INACTIVO = "inactivo",
    BLOQUEADO = "bloqueado",
    PENDIENTE_VERIFICACION = "pendiente_verificacion"
}
export declare class Usuario extends BaseModel {
    empresaId: string;
    nombres: string;
    apellidos: string;
    email: string;
    telefono: string;
    fotoUrl: string;
    passwordHash: string;
    estado: EstadoUsuario;
    emailVerificado: boolean;
    tokenVerificacion: string;
    ultimoAcceso: Date;
    intentosFallidos: number;
    bloqueadoHasta: Date;
    refreshTokenHash: string;
    zonaHoraria: string;
    idioma: string;
    tema: string;
    roles: Rol[];
    get nombreCompleto(): string;
    get nombresRoles(): string[];
    get permisos(): string[];
    get estaActivo(): boolean;
    get estaBloqueado(): boolean;
}
