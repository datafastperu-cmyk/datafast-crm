import { BaseModel } from '../../../common/entities/base.entity';
export declare enum EstadoCliente {
    ACTIVO = "activo",
    SUSPENDIDO = "suspendido",
    MOROSO = "moroso",
    BAJA_TEMPORAL = "baja_temporal",
    BAJA_DEFINITIVA = "baja_definitiva",
    PROSPECTO = "prospecto"
}
export declare enum TipoDocumento {
    DNI = "dni",
    RUC = "ruc",
    CE = "ce",
    PASAPORTE = "pasaporte"
}
export declare enum TipoServicio {
    FTTH = "ftth",
    WISP = "wisp",
    DEDICADO = "dedicado",
    MIXTO = "mixto"
}
export declare class Cliente extends BaseModel {
    empresaId: string;
    tipoDocumento: TipoDocumento;
    numeroDocumento: string;
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string;
    nombreCompleto: string;
    email: string;
    telefono: string;
    telefonoAlt: string;
    whatsapp: string;
    direccion: string;
    referencia: string;
    departamento: string;
    provincia: string;
    distrito: string;
    ubigeo: string;
    latitud: number;
    longitud: number;
    precisionGps: number;
    fotoUrl: string;
    fotoInstalacionUrl: string;
    estado: EstadoCliente;
    fechaEstado: Date;
    motivoEstado: string;
    tipoServicio: TipoServicio;
    codigoCliente: string;
    notasInternas: string;
    etiquetas: string[];
    esEmpresa: boolean;
    rucEmpresa: string;
    razonSocial: string;
    referidoPorId: string;
    vendedorId: string;
    reniecConsultado: boolean;
    reniecConsultadoEn: Date;
    reniecDatosRaw: Record<string, any>;
    createdBy: string;
    updatedBy: string;
    historialEstados: ClienteHistorialEstado[];
}
export declare class ClienteHistorialEstado {
    id: string;
    clienteId: string;
    empresaId: string;
    estadoAnterior: EstadoCliente;
    estadoNuevo: EstadoCliente;
    motivo: string;
    usuarioId: string;
    automatico: boolean;
    createdAt: Date;
    cliente: Cliente;
}
