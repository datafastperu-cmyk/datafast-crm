export declare class AprovisionarFtthDto {
    contratoId: string;
    clienteId: string;
    oltId: string;
    serialNumber?: string;
    ponPort: string;
    perfilSmartolt: string;
    vlanId: number;
    vlanModo?: string;
    routerId: string;
    segmentoId?: string;
    ipManual?: string;
    notificarWhatsApp?: boolean;
    notificarEmail?: boolean;
    omitirQueue?: boolean;
    rollbackEnError?: boolean;
}
export declare class RollbackAprovisionamientoDto {
    contratoId: string;
    motivo?: string;
    eliminarSmartolt?: boolean;
    eliminarPppoe?: boolean;
    liberarIp?: boolean;
}
export declare class PasoResultadoDto {
    paso: number;
    nombre: string;
    estado: 'ok' | 'error' | 'omitido' | 'revertido';
    detalle: string;
    duracionMs?: number;
    datos?: Record<string, any>;
}
export declare class AprovisionamientoResultadoDto {
    pasos: PasoResultadoDto[];
    exitoso: boolean;
    contratoId: string;
    ipAsignada?: string;
    usuarioPppoe?: string;
    onuId?: string;
    serialNumber?: string;
    duracionTotalMs?: number;
    mensajeFinal: string;
    rollbackEjecutado?: boolean;
    pasosFallidos?: number[];
}
