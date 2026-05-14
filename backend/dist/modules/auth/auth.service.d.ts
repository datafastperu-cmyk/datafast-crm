import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { Cache } from 'cache-manager';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { AuditoriaService } from './auditoria.service';
import { LoginDto, ChangePasswordDto, AuthResponseDto } from './dto/auth.dto';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
export declare class AuthService {
    private readonly usuarioRepo;
    private readonly jwtService;
    private readonly config;
    private readonly auditoria;
    private readonly cache;
    private readonly logger;
    constructor(usuarioRepo: Repository<Usuario>, jwtService: JwtService, config: ConfigService, auditoria: AuditoriaService, cache: Cache);
    login(dto: LoginDto, req: Request): Promise<AuthResponseDto>;
    refresh(usuario: Usuario, req: Request): Promise<AuthResponseDto>;
    logout(usuario: JwtPayload, token: string, req: Request): Promise<void>;
    cambiarPassword(usuarioId: string, empresaId: string, dto: ChangePasswordDto, req: Request): Promise<void>;
    getMe(usuarioId: string, empresaId: string): Promise<Usuario>;
    private generarTokens;
    private buildAuthResponse;
    private handleIntentoFallido;
    private parseDuration;
}
