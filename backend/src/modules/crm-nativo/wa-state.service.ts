import { Injectable } from '@nestjs/common';

export type WaEstado = 'INICIANDO' | 'REQUERIDO_QR' | 'CONECTADO' | 'DESCONECTADO';

export interface WaStatusPayload {
  estado: WaEstado;
  qr?:    string | null;
}

// Almacén de estado sin estado mutable compartido entre instancias.
// Solo la instancia 0 de PM2 actualiza este estado.
@Injectable()
export class WaStateService {
  estado: WaEstado      = 'INICIANDO';
  qr:     string | null = null;

  setEstado(estado: WaEstado, qr?: string | null) {
    this.estado = estado;
    this.qr     = qr ?? null;
  }

  snapshot(): WaStatusPayload {
    return { estado: this.estado, qr: this.qr };
  }
}
