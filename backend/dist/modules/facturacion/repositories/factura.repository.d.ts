import { DataSource, SelectQueryBuilder } from 'typeorm';
import { Factura } from '../entities/factura.entity';
import { FilterFacturaDto } from '../dto/factura.dto';
import { PaginatedResult } from '../../../common/utils/pagination.util';
export declare class FacturaRepository {
    private readonly ds;
    private readonly repo;
    constructor(ds: DataSource);
    create(data: Partial<Factura>): Factura;
    save(f: Factura): Promise<Factura>;
    update(id: string, data: Partial<Factura>): Promise<void>;
    findById(id: string, empresaId: string): Promise<Factura | null>;
    findByContrato(contratoId: string, empresaId: string): Promise<Factura[]>;
    findByCliente(clienteId: string, empresaId: string): Promise<Factura[]>;
    findAllPaginated(empresaId: string, filters: FilterFacturaDto): Promise<PaginatedResult<Factura>>;
    buildFilterQuery(empresaId: string, f: FilterFacturaDto): SelectQueryBuilder<Factura>;
    siguienteCorrelativo(empresaId: string, serie: string): Promise<number>;
    existeFacturaPeriodo(contratoId: string, periodoInicio: string, periodoFin: string): Promise<boolean>;
    findContratosParaFacturar(empresaId: string, mes: number, anio: number, soloContratoId?: string): Promise<any[]>;
    findFacturasParaVencer(): Promise<Factura[]>;
    findPendientesPorContrato(contratoId: string): Promise<Factura[]>;
    getResumenFinanciero(empresaId: string): Promise<Record<string, any>>;
    softDelete(id: string): Promise<void>;
}
