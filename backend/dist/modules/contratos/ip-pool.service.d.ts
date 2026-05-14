import { Repository, DataSource } from 'typeorm';
import { SegmentoIpv4, IpAsignada } from './entities/segmento-ipv4.entity';
export declare class IpPoolService {
    private readonly segRepo;
    private readonly ipRepo;
    private readonly ds;
    private readonly logger;
    constructor(segRepo: Repository<SegmentoIpv4>, ipRepo: Repository<IpAsignada>, ds: DataSource);
    createSegmento(data: Partial<SegmentoIpv4>): Promise<SegmentoIpv4>;
    getSegmentos(empresaId: string, routerId?: string): Promise<SegmentoIpv4[]>;
    getSegmento(id: string, empresaId: string): Promise<SegmentoIpv4>;
    asignarSiguienteIpDisponible(segmentoId: string, empresaId: string, contratoId?: string): Promise<{
        ip: string;
        asignacionId: string;
    }>;
    asignarIpEspecifica(ip: string, segmentoId: string, empresaId: string, contratoId?: string): Promise<{
        ip: string;
        asignacionId: string;
    }>;
    liberarIp(contratoId: string, empresaId: string): Promise<void>;
    getDisponibilidad(segmentoId: string, empresaId: string): Promise<{
        segmento: {
            id: string;
            nombre: string;
            redCidr: string;
            gateway: string;
            totalIps: number;
            ipsUsadas: number;
            ipsDisponibles: number;
            porcentajeUso: number;
        };
        ips: {
            ip: string;
            estado: "libre" | "asignada" | "reservada";
        }[];
        hayMas: boolean;
    }>;
    getEstadisticasSegmentos(empresaId: string): Promise<any[]>;
}
