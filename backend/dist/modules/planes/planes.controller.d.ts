import { PlanesService } from './planes.service';
import { CreatePlanDto, UpdatePlanDto, FilterPlanDto } from './dto/plan.dto';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { ApiResponse } from '../../common/dto/response.dto';
export declare class PlanesController {
    private readonly svc;
    constructor(svc: PlanesService);
    create(dto: CreatePlanDto, user: JwtPayload): Promise<ApiResponse<import("./entities/plan.entity").Plan>>;
    findAll(filters: FilterPlanDto, user: JwtPayload): Promise<ApiResponse<import("./entities/plan.entity").Plan[]>>;
    findOne(id: string, user: JwtPayload): Promise<ApiResponse<import("./entities/plan.entity").Plan>>;
    update(id: string, dto: UpdatePlanDto, user: JwtPayload): Promise<ApiResponse<import("./entities/plan.entity").Plan>>;
    remove(id: string, user: JwtPayload): Promise<void>;
}
