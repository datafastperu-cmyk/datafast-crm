import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import { ReniecResponseDto } from './dto/cliente.dto';
export declare class ReniecService {
    private readonly http;
    private readonly config;
    private readonly cache;
    private readonly logger;
    private readonly CACHE_TTL_MS;
    constructor(http: HttpService, config: ConfigService, cache: Cache);
    consultarDni(dni: string): Promise<ReniecResponseDto>;
    private consultarApisNetPe;
    private consultarApiPeru;
    private consultarConsultaPe;
    private normalizar;
    private capitalizarNombre;
    consultarRuc(ruc: string): Promise<{
        razonSocial: string;
        estado: string;
        direccion?: string;
    }>;
}
