import { DataSource } from 'typeorm';
import { SmartoltApiService } from './smartolt-api.service';
import { OnuRepository } from './repositories/onu.repository';
import { AuditoriaService } from '../auth/auditoria.service';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { Onu, Olt } from './entities/onu.entity';
import { CreateOltDto, UpdateOltDto, ProvisionarOnuDto, AsociarOnuContratoDto, FilterOnuDto } from './dto/smartolt.dto';
export declare class SmartoltService {
    private readonly api;
    private readonly onuRepo;
    private readonly auditoria;
    private readonly ds;
    private readonly logger;
    constructor(api: SmartoltApiService, onuRepo: OnuRepository, auditoria: AuditoriaService, ds: DataSource);
    crearOlt(dto: CreateOltDto, user: JwtPayload): Promise<Olt>;
    findAllOlts(empresaId: string): Promise<Olt[]>;
    findOneOlt(id: string, empresaId: string): Promise<Olt>;
    updateOlt(id: string, dto: UpdateOltDto, user: JwtPayload): Promise<Olt>;
    sincronizarOltsDesdeSmartolt(user: JwtPayload): Promise<{
        sincronizados: number;
    }>;
    listarNoAprovisionadas(empresaId: string, oltId?: string): Promise<{
        smartolt: any[];
        local: Onu[];
    }>;
    aprovisionarOnu(dto: ProvisionarOnuDto, user: JwtPayload, req?: any): Promise<Onu>;
    eliminarProvision(id: string, user: JwtPayload, req?: any): Promise<void>;
    asociarAContrato(dto: AsociarOnuContratoDto, user: JwtPayload): Promise<void>;
    sincronizarEstadoOnus(empresaId: string, oltId: string): Promise<{
        actualizadas: number;
        online: number;
        offline: number;
    }>;
    getSeñalOnu(id: string, empresaId: string): Promise<any>;
    reiniciarOnu(id: string, user: JwtPayload): Promise<void>;
    findAll(empresaId: string, filters: FilterOnuDto): Promise<{
        data: unknown[];
        meta: {
            total: number;
            page: number;
            limit: number;
            totalPages: number;
            hasNextPage: boolean;
            hasPrevPage: boolean;
            from: number;
            to: number;
        };
    }>;
    findOneOnu(id: string, empresaId: string): Promise<Onu>;
    findOnuCompleta(id: string, empresaId: string): Promise<any>;
    getResumen(empresaId: string): Promise<{
        resumen: Record<string, number>;
        perfilesDisponibles: any[] | import("./smartolt-api.service").SmartoltProfile[];
    }>;
    listarPerfiles(): Promise<any[]>;
    verificarSmartolt(): Promise<any>;
    private parsePonPort;
}
