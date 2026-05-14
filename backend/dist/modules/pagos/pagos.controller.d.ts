import { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { PagosService } from './pagos.service';
import { RegistrarPagoDto, VerificarPagoDto, ConciliarPagoDto, FilterPagoDto, CrearPreferenciaDto, CreateCuentaBancariaDto } from './dto/pago.dto';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { ApiResponse as StdResponse } from '../../common/dto/response.dto';
export declare class PagosController {
    private readonly svc;
    private readonly logger;
    constructor(svc: PagosService);
    registrar(dto: RegistrarPagoDto, user: JwtPayload, req: Request): Promise<StdResponse<import("./entities/pago.entity").Pago>>;
    findAll(filters: FilterPagoDto, user: JwtPayload): Promise<StdResponse<unknown[]>>;
    getResumen(user: JwtPayload): Promise<StdResponse<import("./dto/pago.dto").ResumenCobranzaDto>>;
    findPendientes(user: JwtPayload): Promise<StdResponse<import("./entities/pago.entity").Pago[]>>;
    getCuentas(user: JwtPayload): Promise<StdResponse<import("./entities/pago.entity").CuentaBancaria[]>>;
    createCuenta(dto: CreateCuentaBancariaDto, user: JwtPayload): Promise<StdResponse<import("./entities/pago.entity").CuentaBancaria>>;
    crearPreferenciaMp(dto: CrearPreferenciaDto, user: JwtPayload): Promise<StdResponse<import("./mercadopago.service").MpPreferencia>>;
    webhookMercadoPago(body: any, req: RawBodyRequest<Request>, xSignature: string, xRequestId: string): Promise<{
        received: boolean;
    }>;
    findByFactura(facturaId: string, user: JwtPayload): Promise<StdResponse<import("./entities/pago.entity").Pago[]>>;
    findByContrato(contratoId: string, user: JwtPayload): Promise<StdResponse<import("./entities/pago.entity").Pago[]>>;
    findByCliente(clienteId: string, user: JwtPayload): Promise<StdResponse<import("./entities/pago.entity").Pago[]>>;
    findOne(id: string, user: JwtPayload): Promise<StdResponse<import("./entities/pago.entity").Pago>>;
    verificar(id: string, dto: VerificarPagoDto, user: JwtPayload, req: Request): Promise<StdResponse<import("./entities/pago.entity").Pago>>;
    conciliar(id: string, dto: ConciliarPagoDto, user: JwtPayload, req: Request): Promise<StdResponse<import("./entities/pago.entity").Pago>>;
    subirComprobante(id: string, file: Express.Multer.File, user: JwtPayload): Promise<StdResponse<{
        comprobanteUrl: string;
    }>>;
    private guardarComprobante;
}
