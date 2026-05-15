import { ConfigService } from '@nestjs/config';
import { ContratoRepository } from './repositories/contrato.repository';
import { PlanesService } from '../planes/planes.service';
import { AuditoriaService } from '../auth/auditoria.service';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { Contrato, ContratoHistorial } from './entities/contrato.entity';
import { CreateContratoDto, UpdateContratoDto, FilterContratoDto, CambiarEstadoContratoDto, OtorgarProrrogaDto } from './dto/contrato.dto';
export declare class ContratosService {
    private readonly contratoRepo;
    private readonly planesSvc;
    private readonly auditoria;
    private readonly config;
    private readonly logger;
    constructor(contratoRepo: ContratoRepository, planesSvc: PlanesService, auditoria: AuditoriaService, config: ConfigService);
    create(dto: CreateContratoDto, user: JwtPayload, req?: any): Promise<Contrato>;
    private asignarIpDesdePool;
    private generarPassword;
    findAll(empresaId: string, filters: FilterContratoDto): Promise<{
        data: Contrato[];
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
    findOne(id: string, empresaId: string): Promise<Contrato>;
    findOneCompleto(id: string, empresaId: string): Promise<any>;
    findByCliente(clienteId: string, empresaId: string): Promise<Contrato[]>;
    update(id: string, dto: UpdateContratoDto, user: JwtPayload, req?: any): Promise<Contrato>;
    cambiarEstado(id: string, dto: CambiarEstadoContratoDto, user: JwtPayload, automatico?: boolean, req?: any): Promise<Contrato>;
    otorgarProrroga(id: string, dto: OtorgarProrrogaDto, user: JwtPayload, req?: any): Promise<Contrato>;
    activar(id: string, user: JwtPayload, req?: any): Promise<Contrato>;
    actualizarDeuda(id: string, deudaTotal: number, mesesDeuda: number, empresaId: string): Promise<void>;
    registrarPago(id: string, fechaPago: string, empresaId: string): Promise<void>;
    getHistorial(id: string, empresaId: string): Promise<ContratoHistorial[]>;
    getResumen(empresaId: string): Promise<any>;
    remove(id: string, user: JwtPayload): Promise<void>;
    getMorososParaCorte(graceDays: number): Promise<Contrato[]>;
    getParaReactivar(): Promise<Contrato[]>;
    getProrrogasVencidas(): Promise<Contrato[]>;
}
