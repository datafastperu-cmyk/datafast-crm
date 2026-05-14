import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { ClienteRepository } from './repositories/cliente.repository';
import { ReniecService } from './reniec.service';
import { AuditoriaService } from '../auth/auditoria.service';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { Cliente } from './entities/cliente.entity';
import { CreateClienteDto, UpdateClienteDto, FilterClienteDto, CambiarEstadoDto, ReniecResponseDto, ExportClientesDto } from './dto/cliente.dto';
export declare class ClientesService {
    private readonly clienteRepo;
    private readonly reniecSvc;
    private readonly auditoria;
    private readonly config;
    private readonly logger;
    constructor(clienteRepo: ClienteRepository, reniecSvc: ReniecService, auditoria: AuditoriaService, config: ConfigService);
    create(dto: CreateClienteDto, user: JwtPayload, req?: any): Promise<Cliente>;
    findAll(empresaId: string, filters: FilterClienteDto): Promise<{
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
    findOne(id: string, empresaId: string): Promise<Cliente>;
    update(id: string, dto: UpdateClienteDto, user: JwtPayload, req?: any): Promise<Cliente>;
    cambiarEstado(id: string, dto: CambiarEstadoDto, user: JwtPayload, automatico?: boolean, req?: any): Promise<Cliente>;
    remove(id: string, user: JwtPayload, req?: any): Promise<void>;
    getHistorial(id: string, empresaId: string): Promise<import("./entities/cliente.entity").ClienteHistorialEstado[]>;
    getResumen(empresaId: string): Promise<{
        totales: any[];
        nuevosEsteMes: number;
        estados: Record<string, number>;
    }>;
    getMapa(empresaId: string): Promise<Partial<Cliente>[]>;
    consultarReniec(dni: string): Promise<ReniecResponseDto>;
    exportar(empresaId: string, filters: ExportClientesDto, res: Response): Promise<void>;
    private exportarCsv;
    private exportarXlsx;
    private escapeCsv;
    private generarCodigoCliente;
}
