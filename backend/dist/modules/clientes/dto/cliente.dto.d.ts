import { PaginationDto } from '../../../common/dto/response.dto';
import { EstadoCliente, TipoDocumento, TipoServicio } from '../entities/cliente.entity';
export declare class CreateClienteDto {
    tipoDocumento?: TipoDocumento;
    numeroDocumento: string;
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno?: string;
    email?: string;
    telefono: string;
    telefonoAlt?: string;
    whatsapp?: string;
    direccion: string;
    referencia?: string;
    departamento?: string;
    provincia?: string;
    distrito?: string;
    ubigeo?: string;
    latitud?: number;
    longitud?: number;
    tipoServicio?: TipoServicio;
    codigoCliente?: string;
    notasInternas?: string;
    etiquetas?: string[];
    esEmpresa?: boolean;
    rucEmpresa?: string;
    razonSocial?: string;
    fotoUrl?: string;
}
declare const UpdateClienteDto_base: import("@nestjs/common").Type<Partial<CreateClienteDto>>;
export declare class UpdateClienteDto extends UpdateClienteDto_base {
}
export declare class FilterClienteDto extends PaginationDto {
    estado?: EstadoCliente;
    estados?: EstadoCliente[];
    tipoServicio?: TipoServicio;
    tipoDocumento?: TipoDocumento;
    documento?: string;
    telefono?: string;
    distrito?: string;
    vendedorId?: string;
    conUbicacion?: boolean;
    esEmpresa?: boolean;
    etiqueta?: string;
    fechaDesde?: string;
    fechaHasta?: string;
}
export declare class CambiarEstadoDto {
    estado: EstadoCliente;
    motivo?: string;
}
export declare class ConsultarReniecDto {
    dni: string;
}
export declare class ReniecResponseDto {
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string;
    nombreCompleto: string;
    dni: string;
    direccion?: string;
    ubigeo?: string;
    fuente: string;
    consultadoEn: string;
}
declare const ExportClientesDto_base: import("@nestjs/common").Type<Omit<FilterClienteDto, "page" | "limit" | "sortBy" | "sortOrder">>;
export declare class ExportClientesDto extends ExportClientesDto_base {
    formato?: 'csv' | 'xlsx';
}
export {};
