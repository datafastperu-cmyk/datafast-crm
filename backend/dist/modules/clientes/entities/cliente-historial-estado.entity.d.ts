import { Cliente, EstadoCliente } from './cliente.entity';
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
