import { Request, Response } from 'express';
import { FacturacionService } from './facturacion.service';
import { CreateFacturaDto, GenerarFacturasMensualesDto, CreateNotaCreditoDto, AnularFacturaDto, FilterFacturaDto } from './dto/factura.dto';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { ApiResponse as StdResponse } from '../../common/dto/response.dto';
export declare class FacturacionController {
    private readonly svc;
    private readonly logger;
    constructor(svc: FacturacionService);
    create(dto: CreateFacturaDto, user: JwtPayload, req: Request): Promise<StdResponse<import("./entities/factura.entity").Factura>>;
    generarMensual(dto: GenerarFacturasMensualesDto, user: JwtPayload, req: Request): Promise<StdResponse<import("./facturacion.service").ResultadoGeneracion>>;
    findAll(filters: FilterFacturaDto, user: JwtPayload): Promise<StdResponse<unknown[]>>;
    getResumen(user: JwtPayload): Promise<StdResponse<import("./dto/factura.dto").ResumenFinancieroDto>>;
    findByContrato(contratoId: string, user: JwtPayload): Promise<StdResponse<import("./entities/factura.entity").Factura[]>>;
    findByCliente(clienteId: string, user: JwtPayload): Promise<StdResponse<import("./entities/factura.entity").Factura[]>>;
    findOne(id: string, user: JwtPayload): Promise<StdResponse<import("./entities/factura.entity").Factura>>;
    descargarPdf(id: string, user: JwtPayload, res: Response): Promise<void | Response<any, Record<string, any>>>;
    regenerarPdf(id: string, user: JwtPayload): Promise<StdResponse<{
        pdfUrl: string;
    }>>;
    crearNotaCredito(id: string, dto: Omit<CreateNotaCreditoDto, 'facturaOriginalId'>, user: JwtPayload, req: Request): Promise<StdResponse<import("./entities/factura.entity").Factura>>;
    anular(id: string, dto: AnularFacturaDto, user: JwtPayload, req: Request): Promise<StdResponse<{
        factura: import("./entities/factura.entity").Factura;
        notaCredito?: import("./entities/factura.entity").Factura;
    }>>;
    marcarVencidas(user: JwtPayload): Promise<StdResponse<{
        marcadas: number;
    }>>;
}
