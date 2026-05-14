import { CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
export declare class WsJwtGuard implements CanActivate {
    private readonly jwtService;
    private readonly config;
    private readonly cache;
    private readonly logger;
    constructor(jwtService: JwtService, config: ConfigService, cache: Cache);
    canActivate(context: ExecutionContext): Promise<boolean>;
    private extractToken;
}
