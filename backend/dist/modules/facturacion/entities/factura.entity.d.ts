import { BaseModel } from '../../../common/entities/base.entity';
export declare enum TipoComprobante {
    BOLETA = "boleta",
    FACTURA = "factura",
    NOTA_CREDITO = "nota_credito",
    NOTA_DEBITO = "nota_debito",
    RECIBO_INTERNO = "recibo_interno"
}
export declare enum EstadoFactura {
    BORRADOR = "borrador",
    EMITIDA = "emitida",
    PAGADA = "pagada",
    PAGADA_PARCIAL = "pagada_parcial",
    VENCIDA = "vencida",
    ANULADA = "anulada",
    EN_COBRANZA = "en_cobranza"
}
export interface ItemFactura {
    descripcion: string;
    cantidad: number;
    precioUnitario: number;
    descuento?: number;
    subtotal: number;
}
export declare class Factura extends BaseModel {
    empresaId: string;
    clienteId: string;
    contratoId: string;
    tipoComprobante: TipoComprobante;
    serie: string;
    correlativo: number;
    numeroCompleto: string;
    periodoInicio: string;
    periodoFin: string;
    descripcion: string;
    subtotal: number;
    descuento: number;
    baseImponible: number;
    igv: number;
    total: number;
    montoPagado: number;
    saldo: number;
    moneda: string;
    tipoCambio: number;
    estado: EstadoFactura;
    fechaEmision: string;
    fechaVencimiento: string;
    fechaPago: string;
    items: ItemFactura[];
    pdfUrl: string;
    pdfGeneradoEn: Date;
    sunatEnviada: boolean;
    sunatAceptada: boolean;
    sunatCodigoHash: string;
    sunatError: string;
    sunatEnviadaEn: Date;
    facturaOriginalId: string;
    motivoAnulacion: string;
    anuladaEn: Date;
    anuladaPor: string;
    generadaAutomaticamente: boolean;
    enviadaPorEmail: boolean;
    enviadaPorWhatsapp: boolean;
    createdBy: string;
    get estaVencida(): boolean;
    get esPagada(): boolean;
    get saldoPendiente(): number;
    get diasVencida(): number;
}
