import { Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { Usuario } from '../../usuarios/entities/usuario.entity';
declare const JwtRefreshStrategy_base: new (...args: any[]) => Strategy;
export declare class JwtRefreshStrategy extends JwtRefreshStrategy_base {
    private readonly config;
    private readonly usuarioRepo;
    constructor(config: ConfigService, usuarioRepo: Repository<Usuario>);
    validate(req: Request, payload: any): Promise<Usuario>;
}
export {};
