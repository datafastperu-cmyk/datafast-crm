import { TipoComprobante, EstadoFactura } from '../entities/factura.entity';
import { PaginationDto } from '../../../common/dto/response.dto';
export declare class ItemFacturaDto {
    descripcion: string;
    cantidad: number;
    precioUnitario: number;
    descuento?: number;
}
export declare class CreateFacturaDto {
    clienteId: string;
    contratoId?: string;
    tipoComprobante?: TipoComprobante;
    periodoInicio: string;
    periodoFin: string;
    descripcion?: string;
    items?: ItemFacturaDto[];
    subtotal?: number;
    descuento?: number;
    fechaVencimiento?: string;
    aplicaIgv?: boolean;
    moneda?: string;
}
export declare class GenerarFacturasMensualesDto {
    anio?: number;
    mes?: number;
    contratoId?: string;
    tipoComprobante?: TipoComprobante;
}
export declare class CreateNotaCreditoDto {
    facturaOriginalId: string;
    motivo: string;
    montoAcreditar?: number;
}
export declare class AnularFacturaDto {
    motivo: string;
    crearNotaCredito?: boolean;
}
export declare class FilterFacturaDto extends PaginationDto {
    estado?: EstadoFactura;
    estados?: EstadoFactura[];
    clienteId?: string;
    contratoId?: string;
    tipoComprobante?: TipoComprobante;
    serie?: string;
    fechaDesde?: string;
    fechaHasta?: string;
    vencidas?: boolean;
    automatica?: boolean;
}
export declare class ResumenFinancieroDto {
    facturadoMes: number;
    cobradoMes: number;
    cobradoHoy: number;
    cobradoMesAnterior: number;
    cuentasPorCobrar: number;
    facturasVencidas: number;
    totalEmitidas: number;
    totalPagadas: number;
    totalAnuladas: number;
    tasaCobranza: number;
}
