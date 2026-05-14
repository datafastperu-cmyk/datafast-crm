import { Request } from 'express';
import { SmartoltService } from './smartolt.service';
import { OrquestadorFtthService } from './orquestador-ftth.service';
import { CreateOltDto, UpdateOltDto, ProvisionarOnuDto, AsociarOnuContratoDto, FilterOnuDto, FlujoComipletoFtthDto } from './dto/smartolt.dto';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { ApiResponse as StdResponse } from '../../common/dto/response.dto';
export declare class SmartoltController {
    private readonly svc;
    private readonly orquestador;
    private readonly logger;
    constructor(svc: SmartoltService, orquestador: OrquestadorFtthService);
    health(user: JwtPayload): Promise<StdResponse<any>>;
    crearOlt(dto: CreateOltDto, user: JwtPayload): Promise<StdResponse<import("./entities/onu.entity").Olt>>;
    listarOlts(user: JwtPayload): Promise<StdResponse<import("./entities/onu.entity").Olt[]>>;
    getOlt(id: string, user: JwtPayload): Promise<StdResponse<import("./entities/onu.entity").Olt>>;
    updateOlt(id: string, dto: UpdateOltDto, user: JwtPayload): Promise<StdResponse<import("./entities/onu.entity").Olt>>;
    sincronizarOlts(user: JwtPayload): Promise<StdResponse<{
        sincronizados: number;
    }>>;
    getEstadisticasOlt(id: string, user: JwtPayload): Promise<StdResponse<any>>;
    listarNoAprovisionadas(oltId: string, user: JwtPayload): Promise<StdResponse<{
        smartolt: any[];
        local: import("./entities/onu.entity").Onu[];
    }>>;
    provisionar(dto: ProvisionarOnuDto, user: JwtPayload, req: Request): Promise<StdResponse<import("./entities/onu.entity").Onu>>;
    flujoCompleto(dto: FlujoComipletoFtthDto, user: JwtPayload): Promise<StdResponse<import("./dto/smartolt.dto").FlujoComipletoResultadoDto>>;
    findAll(filters: FilterOnuDto, user: JwtPayload): Promise<StdResponse<unknown[]>>;
    getResumen(user: JwtPayload): Promise<StdResponse<{
        resumen: Record<string, number>;
        perfilesDisponibles: any[] | import("./smartolt-api.service").SmartoltProfile[];
    }>>;
    findOne(id: string, user: JwtPayload): Promise<StdResponse<any>>;
    getSeñal(id: string, user: JwtPayload): Promise<StdResponse<any>>;
    reiniciar(id: string, user: JwtPayload): Promise<StdResponse<any>>;
    eliminarProvision(id: string, user: JwtPayload, req: Request): Promise<StdResponse<any>>;
    asociarContrato(dto: AsociarOnuContratoDto, user: JwtPayload): Promise<StdResponse<any>>;
    sincronizarEstado(oltId: string, user: JwtPayload): Promise<StdResponse<{
        actualizadas: number;
        online: number;
        offline: number;
    }>>;
    listarPerfiles(user: JwtPayload): Promise<StdResponse<any[]>>;
}
