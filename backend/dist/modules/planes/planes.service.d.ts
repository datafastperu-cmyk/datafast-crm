import { Repository } from 'typeorm';
import { Plan } from './entities/plan.entity';
import { CreatePlanDto, UpdatePlanDto, FilterPlanDto } from './dto/plan.dto';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
export declare class PlanesService {
    private readonly repo;
    private readonly logger;
    constructor(repo: Repository<Plan>);
    create(dto: CreatePlanDto, user: JwtPayload): Promise<Plan>;
    findAll(empresaId: string, filters: FilterPlanDto): Promise<{
        data: Plan[];
        total: number;
    }>;
    findOne(id: string, empresaId: string): Promise<Plan>;
    update(id: string, dto: UpdatePlanDto, user: JwtPayload): Promise<Plan>;
    remove(id: string, user: JwtPayload): Promise<void>;
}
