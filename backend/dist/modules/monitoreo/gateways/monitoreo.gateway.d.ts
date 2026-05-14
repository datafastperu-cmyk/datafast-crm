import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
export declare class MonitoreoGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    private readonly jwt;
    private readonly config;
    server: Server;
    private readonly logger;
    private readonly clientes;
    constructor(jwt: JwtService, config: ConfigService);
    afterInit(server: Server): void;
    handleConnection(socket: Socket): Promise<void>;
    handleDisconnect(socket: Socket): void;
    handleSubscribe(socket: Socket, data: {
        nodoId: string;
    }): void;
    handleUnsubscribe(socket: Socket, data: {
        nodoId: string;
    }): void;
    broadcastMedicion(empresaId: string, datos: {
        nodoId: string;
        nodoNombre: string;
        estado: string;
        latenciaMs: number | null;
        perdidaPct: number;
        cpuPct?: number;
        memoriaPct?: number;
        traficoRxBps?: number;
        traficoTxBps?: number;
        temperatura?: number;
        sesionesPppoe?: number;
        timestamp: string;
    }): void;
    broadcastDashboard(empresaId: string, dashboard: any): void;
    onAlertaNueva(payload: {
        alerta: any;
        empresaId: string;
    }): void;
    onAlertaResuelta(payload: any): void;
    onNodoOffline(payload: any): void;
    onNodoOnline(payload: any): void;
    onAprovisionamientoCompletado(payload: any): void;
    onClienteSuspendido(payload: any): void;
    onClienteReactivado(payload: any): void;
    getStats(): {
        clientesConectados: number;
        porEmpresa: Record<string, number>;
        uptime: number;
    };
}
