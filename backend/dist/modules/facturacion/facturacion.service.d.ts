import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { FacturaRepository } from './repositories/factura.repository';
import { PdfService } from './pdf.service';
import { AuditoriaService } from '../auth/auditoria.service';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { Factura } from './entities/factura.entity';
import { CreateFacturaDto, GenerarFacturasMensualesDto, CreateNotaCreditoDto, AnularFacturaDto, FilterFacturaDto, ResumenFinancieroDto } from './dto/factura.dto';
export interface ResultadoGeneracion {
    total: number;
    exitosas: number;
    omitidas: number;
    errores: number;
    detalles: Array<{
        contratoId: string;
        numeroContrato: string;
        resultado: string;
        error?: string;
    }>;
}
export declare class FacturacionService {
    private readonly facturaRepo;
    private readonly pdfSvc;
    private readonly auditoria;
    private readonly config;
    private readonly ds;
    private readonly logger;
    constructor(facturaRepo: FacturaRepository, pdfSvc: PdfService, auditoria: AuditoriaService, config: ConfigService, ds: DataSource);
    create(dto: CreateFacturaDto, user: JwtPayload, req?: any): Promise<Factura>;
    generarMensual(dto: GenerarFacturasMensualesDto, user: JwtPayload, req?: any): Promise<ResultadoGeneracion>;
    anular(id: string, dto: AnularFacturaDto, user: JwtPayload, req?: any): Promise<{
        factura: Factura;
        notaCredito?: Factura;
    }>;
    crearNotaCredito(dto: CreateNotaCreditoDto, user: JwtPayload, req?: any): Promise<Factura>;
    marcarVencidas(): Promise<number>;
    aplicarPago(facturaId: string, montoPago: number, empresaId: string, fechaPago: string): Promise<Factura>;
    regenerarPdf(id: string, empresaId: string): Promise<Factura>;
    findAll(empresaId: string, filters: FilterFacturaDto): Promise<{
        data: Factura[];
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
    findOne(id: string, empresaId: string): Promise<Factura>;
    findByContrato(contratoId: string, empresaId: string): Promise<Factura[]>;
    findByCliente(clienteId: string, empresaId: string): Promise<Factura[]>;
    getResumenFinanciero(empresaId: string): Promise<ResumenFinancieroDto>;
    getPendientesPorContrato(contratoId: string): Promise<Factura[]>;
    private calcularMontos;
    private calcularMontosDesdeBase;
    private obtenerSerieCorrelativo;
    private calcularFechaVencimiento;
    private getIgvRate;
    private ultimoDiaMes;
    private mesNombre;
    private buildItemsDesdeContrato;
    private generarPdfAsync;
}
