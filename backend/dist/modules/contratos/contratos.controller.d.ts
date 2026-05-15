import { Request } from 'express';
import { ContratosService } from './contratos.service';
import { CreateContratoDto, UpdateContratoDto, FilterContratoDto, CambiarEstadoContratoDto, OtorgarProrrogaDto } from './dto/contrato.dto';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { ApiResponse as StdResponse } from '../../common/dto/response.dto';
export declare class ContratosController {
    private readonly svc;
    constructor(svc: ContratosService);
    create(dto: CreateContratoDto, user: JwtPayload, req: Request): Promise<StdResponse<import("./entities/contrato.entity").Contrato>>;
    findAll(filters: FilterContratoDto, user: JwtPayload): Promise<StdResponse<import("./entities/contrato.entity").Contrato[]>>;
    getResumen(user: JwtPayload): Promise<StdResponse<any>>;
    findOne(id: string, user: JwtPayload): Promise<StdResponse<any>>;
    findByCliente(clienteId: string, user: JwtPayload): Promise<StdResponse<import("./entities/contrato.entity").Contrato[]>>;
    update(id: string, dto: UpdateContratoDto, user: JwtPayload, req: Request): Promise<StdResponse<import("./entities/contrato.entity").Contrato>>;
    activar(id: string, user: JwtPayload, req: Request): Promise<StdResponse<import("./entities/contrato.entity").Contrato>>;
    cambiarEstado(id: string, dto: CambiarEstadoContratoDto, user: JwtPayload, req: Request): Promise<StdResponse<import("./entities/contrato.entity").Contrato>>;
    otorgarProrroga(id: string, dto: OtorgarProrrogaDto, user: JwtPayload, req: Request): Promise<StdResponse<import("./entities/contrato.entity").Contrato>>;
    getHistorial(id: string, user: JwtPayload): Promise<StdResponse<import("./entities/contrato.entity").ContratoHistorial[]>>;
    remove(id: string, user: JwtPayload): Promise<void>;
}
