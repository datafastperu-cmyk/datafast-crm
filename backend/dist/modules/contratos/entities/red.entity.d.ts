import { BaseModel } from '../../../common/entities/base.entity';
export declare class SegmentoIpv4 extends BaseModel {
    empresaId: string;
    routerId: string;
    nodoId: string;
    nombre: string;
    descripcion: string;
    redCidr: string;
    gateway: string;
    dnsPrimario: string;
    dnsSecundario: string;
    ipsReservadas: string[];
    totalIps: number;
    ipsUsadas: number;
    ipsDisponibles: number;
    tipoServicio: string;
    vlanId: number;
    activo: boolean;
    get porcentajeUso(): number;
}
export declare class IpAsignada {
    id: string;
    empresaId: string;
    segmentoId: string;
    contratoId: string;
    ipAddress: string;
    descripcion: string;
    tipo: string;
    activa: boolean;
    asignadaEn: Date;
    liberadaEn: Date;
    createdAt: Date;
}
