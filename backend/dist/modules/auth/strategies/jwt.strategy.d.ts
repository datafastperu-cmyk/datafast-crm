import { Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { Cache } from 'cache-manager';
import { Usuario } from '../../usuarios/entities/usuario.entity';
import { JwtPayload } from '../../../common/decorators/current-user.decorator';
declare const JwtStrategy_base: new (...args: any[]) => Strategy;
export declare class JwtStrategy extends JwtStrategy_base {
    private readonly config;
    private readonly usuarioRepo;
    private readonly cache;
    constructor(config: ConfigService, usuarioRepo: Repository<Usuario>, cache: Cache);
    validate(req: Request, payload: JwtPayload): Promise<JwtPayload>;
}
export {};
