import { Request } from 'express';
import { AuthService } from './auth.service';
import { AuditoriaService } from './auditoria.service';
import { LoginDto, ChangePasswordDto, AuthResponseDto } from './dto/auth.dto';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
export declare class AuthController {
    private readonly authService;
    private readonly auditoria;
    private readonly logger;
    constructor(authService: AuthService, auditoria: AuditoriaService);
    login(dto: LoginDto, req: Request): Promise<AuthResponseDto>;
    refresh(req: Request & {
        user: any;
    }): Promise<AuthResponseDto>;
    logout(user: JwtPayload, req: Request): Promise<void>;
    me(user: JwtPayload): Promise<import("../usuarios/entities/usuario.entity").Usuario>;
    changePassword(user: JwtPayload, dto: ChangePasswordDto, req: Request): Promise<void>;
    getPermissions(user: JwtPayload): Promise<{
        roles: string[];
        permisos: string[];
        esAdmin: boolean;
    }>;
    getAudit(user: JwtPayload): Promise<import("../usuarios/entities/auditoria-log.entity").AuditoriaLog[]>;
}
