import { BaseModel } from '../../../common/entities/base.entity';
export declare enum EstadoContrato {
    PENDIENTE_INSTALACION = "pendiente_instalacion",
    ACTIVO = "activo",
    SUSPENDIDO_MORA = "suspendido_mora",
    SUSPENDIDO_MANUAL = "suspendido_manual",
    PRORROGA = "prorroga",
    BAJA_SOLICITADA = "baja_solicitada",
    BAJA_DEFINITIVA = "baja_definitiva",
    MIGRADO = "migrado"
}
export declare class Contrato extends BaseModel {
    empresaId: string;
    clienteId: string;
    planId: string;
    routerId: string;
    nodoId: string;
    onuId: string;
    segmentoId: string;
    tecnicoInstalacionId: string;
    vendedorId: string;
    numeroContrato: string;
    estado: EstadoContrato;
    fechaEstado: Date;
    motivoEstado: string;
    fechaInicio: string;
    fechaVencimiento: string;
    fechaInstalacion: Date;
    fechaBaja: string;
    motivoBaja: string;
    direccionInstalacion: string;
    latitudInstalacion: number;
    longitudInstalacion: number;
    usuarioPppoe: string;
    passwordPppoe: string;
    ipAsignada: string;
    macAddress: string;
    vlanId: number;
    nombreQueue: string;
    precioMensual: number;
    descuentoPct: number;
    descuentoMotivo: string;
    precioFinal: number;
    enProrroga: boolean;
    prorrogaHasta: string;
    prorrogaMotivo: string;
    prorrogaOtorgadaPor: string;
    diaFacturacion: number;
    fechaUltimoPago: string;
    deudaTotal: number;
    mesesDeuda: number;
    aprovisionado: boolean;
    aprovisionadoEn: Date;
    notasInstalacion: string;
    notasTecnicas: string;
    notasAdmin: string;
    createdBy: string;
    updatedBy: string;
    historial: ContratoHistorial[];
    get estaActivo(): boolean;
    get estaSuspendido(): boolean;
    get tieneMora(): boolean;
    get precioConDescuento(): number;
}
export declare class ContratoHistorial {
    id: string;
    contratoId: string;
    empresaId: string;
    estadoAnterior: EstadoContrato;
    estadoNuevo: EstadoContrato;
    motivo: string;
    usuarioId: string;
    automatico: boolean;
    createdAt: Date;
    contrato: Contrato;
}
