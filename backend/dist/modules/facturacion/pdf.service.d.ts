import { ConfigService } from '@nestjs/config';
import { Factura } from '../entities/factura.entity';
export interface EmpresaPdfData {
    razonSocial: string;
    ruc: string;
    direccionFiscal?: string;
    telefono?: string;
    email?: string;
    logoUrl?: string;
}
export interface ClientePdfData {
    nombreCompleto: string;
    tipoDocumento: string;
    numeroDocumento: string;
    direccion?: string;
    email?: string;
    telefono?: string;
    esEmpresa?: boolean;
    rucEmpresa?: string;
    razonSocial?: string;
}
export declare class PdfService {
    private readonly config;
    private readonly logger;
    private readonly uploadDir;
    private readonly colors;
    constructor(config: ConfigService);
    generarFacturaPdf(factura: Factura, empresa: EmpresaPdfData, cliente: ClientePdfData): Promise<string>;
    private drawHeader;
    private drawBadgeEstado;
    private drawDatosCliente;
    private drawTablaItems;
    private drawTotales;
    private drawPieDocumento;
    private drawQr;
    private drawWatermark;
    private getTipoLabel;
    private formatDate;
    private formatMoney;
    private montoALetras;
    private numeroALetras;
}
