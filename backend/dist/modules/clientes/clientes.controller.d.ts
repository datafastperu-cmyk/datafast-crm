import { Request, Response } from 'express';
import { ClientesService } from './clientes.service';
import { CreateClienteDto, UpdateClienteDto, FilterClienteDto, CambiarEstadoDto, ConsultarReniecDto, ExportClientesDto } from './dto/cliente.dto';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { ApiResponse as StdResponse } from '../../common/dto/response.dto';
export declare class ClientesController {
    private readonly clientesSvc;
    private readonly logger;
    constructor(clientesSvc: ClientesService);
    create(dto: CreateClienteDto, user: JwtPayload, req: Request): Promise<StdResponse<import("./entities/cliente.entity").Cliente>>;
    findAll(filters: FilterClienteDto, user: JwtPayload): Promise<StdResponse<unknown[]>>;
    getResumen(user: JwtPayload): Promise<StdResponse<{
        totales: any[];
        nuevosEsteMes: number;
        estados: Record<string, number>;
    }>>;
    getMapa(user: JwtPayload): Promise<StdResponse<Partial<import("./entities/cliente.entity").Cliente>[]>>;
    exportar(filters: ExportClientesDto, user: JwtPayload, res: Response): Promise<void>;
    consultarReniec(dto: ConsultarReniecDto): Promise<StdResponse<import("./dto/cliente.dto").ReniecResponseDto>>;
    findOne(id: string, user: JwtPayload): Promise<StdResponse<import("./entities/cliente.entity").Cliente>>;
    update(id: string, dto: UpdateClienteDto, user: JwtPayload, req: Request): Promise<StdResponse<import("./entities/cliente.entity").Cliente>>;
    patch(id: string, dto: UpdateClienteDto, user: JwtPayload, req: Request): Promise<StdResponse<import("./entities/cliente.entity").Cliente>>;
    cambiarEstado(id: string, dto: CambiarEstadoDto, user: JwtPayload, req: Request): Promise<StdResponse<import("./entities/cliente.entity").Cliente>>;
    getHistorial(id: string, user: JwtPayload): Promise<StdResponse<import("./entities/cliente.entity").ClienteHistorialEstado[]>>;
    subirFoto(id: string, file: Express.Multer.File, user: JwtPayload, req: Request): Promise<StdResponse<{
        fotoUrl: string;
    }>>;
    remove(id: string, user: JwtPayload, req: Request): Promise<void>;
    private procesarFoto;
}
