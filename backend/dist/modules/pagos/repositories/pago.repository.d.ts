import { DataSource, SelectQueryBuilder } from 'typeorm';
import { Pago, MetodoPago, CuentaBancaria } from '../entities/pago.entity';
import { FilterPagoDto } from '../dto/pago.dto';
import { PaginatedResult } from '../../../common/utils/pagination.util';
export declare class PagoRepository {
    private readonly ds;
    private readonly repo;
    private readonly cuentaRepo;
    constructor(ds: DataSource);
    create(data: Partial<Pago>): Pago;
    save(p: Pago): Promise<Pago>;
    update(id: string, data: Partial<Pago>): Promise<void>;
    findById(id: string, empresaId: string): Promise<Pago | null>;
    findByFactura(facturaId: string, empresaId: string): Promise<Pago[]>;
    findByContrato(contratoId: string, empresaId: string): Promise<Pago[]>;
    findByCliente(clienteId: string, empresaId: string, limit?: number): Promise<Pago[]>;
    findAllPaginated(empresaId: string, filters: FilterPagoDto): Promise<PaginatedResult<Pago>>;
    buildFilterQuery(empresaId: string, f: FilterPagoDto): SelectQueryBuilder<Pago>;
    existeDuplicado(empresaId: string, metodoPago: MetodoPago, numeroOperacion: string, excludeId?: string): Promise<{
        existe: boolean;
        pagoExistente?: Pago;
    }>;
    findByMpPaymentId(mpPaymentId: string): Promise<Pago | null>;
    findPendientesVerificar(empresaId: string): Promise<Pago[]>;
    findVerificadosPeriodo(empresaId: string, fechaDesde: string, fechaHasta: string, banco?: string): Promise<Pago[]>;
    calcularDeudaContrato(contratoId: string): Promise<{
        deuda: number;
        meses: number;
    }>;
    findFacturasPendientes(contratoId: string, empresaId: string): Promise<Array<{
        id: string;
        total: number;
        saldo: number;
        serie: string;
        correlativo: number;
    }>>;
    getResumenCobranza(empresaId: string): Promise<Record<string, any>>;
    findUltimos(empresaId: string, limit?: number): Promise<any[]>;
    findCuentas(empresaId: string): Promise<CuentaBancaria[]>;
    saveCuenta(c: CuentaBancaria): Promise<CuentaBancaria>;
    createCuenta(data: Partial<CuentaBancaria>): Promise<CuentaBancaria>;
}
