import { OrquestadorAprovisionamientoService } from './aprovisionamiento.service';
import { AprovisionarFtthDto, RollbackAprovisionamientoDto, AprovisionamientoResultadoDto } from './aprovisionamiento.dto';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { ApiResponse as StdResponse } from '../../common/dto/response.dto';
export declare class AprovisionamientoController {
    private readonly svc;
    private readonly logger;
    constructor(svc: OrquestadorAprovisionamientoService);
    aprovisionar(dto: AprovisionarFtthDto, user: JwtPayload): Promise<AprovisionamientoResultadoDto>;
    rollback(dto: RollbackAprovisionamientoDto, user: JwtPayload): Promise<StdResponse<{
        revertidos: string[];
        errores: string[];
    }>>;
    renotificar(contratoId: string, user: JwtPayload): Promise<StdResponse<any>>;
}
