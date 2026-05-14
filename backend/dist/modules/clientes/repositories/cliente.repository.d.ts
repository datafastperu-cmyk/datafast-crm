import { DataSource, SelectQueryBuilder } from 'typeorm';
import { Cliente, ClienteHistorialEstado } from '../entities/cliente.entity';
import { FilterClienteDto } from '../dto/cliente.dto';
import { PaginatedResult } from '../../../common/utils/pagination.util';
export declare class ClienteRepository {
    private readonly ds;
    private readonly repo;
    private readonly histRepo;
    constructor(ds: DataSource);
    create(data: Partial<Cliente>): Cliente;
    save(c: Cliente): Promise<Cliente>;
    findById(id: string, empresaId: string): Promise<Cliente | null>;
    findByDocumento(tipo: string, numero: string, empresaId: string): Promise<Cliente | null>;
    findAllPaginated(empresaId: string, filters: FilterClienteDto): Promise<PaginatedResult<Cliente>>;
    buildFilterQuery(empresaId: string, filters: FilterClienteDto): SelectQueryBuilder<Cliente>;
    getResumenEstados(empresaId: string): Promise<Record<string, number>>;
    findConUbicacion(empresaId: string): Promise<Partial<Cliente>[]>;
    softDelete(id: string, empresaId: string): Promise<void>;
    update(id: string, data: Partial<Cliente>): Promise<void>;
    existeDocumento(tipo: string, numero: string, empresaId: string, excludeId?: string): Promise<boolean>;
    guardarHistorial(data: Partial<ClienteHistorialEstado>): Promise<void>;
    getHistorialEstados(clienteId: string): Promise<ClienteHistorialEstado[]>;
    getEstadisticas(empresaId: string): Promise<{
        totales: any[];
        nuevosEsteMes: number;
    }>;
    findAllForExport(empresaId: string, filters: any): Promise<Cliente[]>;
}
