import { DataSource } from 'typeorm';
import { Olt, Onu } from '../entities/onu.entity';
import { FilterOnuDto } from '../dto/smartolt.dto';
import { PaginatedResult } from '../../../common/utils/pagination.util';
export declare class OnuRepository {
    private readonly ds;
    private readonly onuRepo;
    private readonly oltRepo;
    constructor(ds: DataSource);
    saveOlt(data: Partial<Olt>): Promise<Olt>;
    findOltById(id: string, empresaId: string): Promise<Olt | null>;
    findAllOlts(empresaId: string): Promise<Olt[]>;
    updateOlt(id: string, data: Partial<Olt>): Promise<void>;
    create(data: Partial<Onu>): Onu;
    save(onu: Onu): Promise<Onu>;
    update(id: string, data: Partial<Onu>): Promise<void>;
    findById(id: string, empresaId: string): Promise<Onu | null>;
    findBySerial(serial: string, empresaId: string): Promise<Onu | null>;
    findByContratoId(contratoId: string): Promise<Onu | null>;
    findAllPaginated(empresaId: string, filters: FilterOnuDto): Promise<PaginatedResult<Onu>>;
    findByOlt(oltId: string, empresaId: string): Promise<Onu[]>;
    findSinAprovisionar(empresaId: string, oltId?: string): Promise<Onu[]>;
    softDelete(id: string): Promise<void>;
    getResumen(empresaId: string): Promise<Record<string, number>>;
    findCompletaPorId(id: string, empresaId: string): Promise<any>;
}
