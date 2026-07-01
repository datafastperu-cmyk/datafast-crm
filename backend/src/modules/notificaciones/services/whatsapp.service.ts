// Tipos de notificación y parámetros del sistema de mensajería
// El proveedor externo ya no es Meta Graph — este archivo conserva las definiciones
// de tipos reutilizadas por gateway-mensajeria.service.ts y el event listener.

export enum TipoNotificacion {
  SERVICIO_ACTIVADO    = 'servicio_activado',
  SERVICIO_SUSPENDIDO  = 'servicio_suspendido',
  SERVICIO_REACTIVADO  = 'servicio_reactivado',
  FACTURA_EMITIDA      = 'factura_emitida',
  PAGO_RECIBIDO        = 'pago_recibido',
  PAGO_VENCE_HOY       = 'pago_vence_hoy',
  PAGO_VENCIDO         = 'pago_vencido',
  PRORROGA_CONCEDIDA   = 'prorroga_concedida',
  BIENVENIDA           = 'bienvenida',
  MANTENIMIENTO        = 'mantenimiento',
  ALERTA_EGRESO        = 'alerta_egreso',
}

export interface WhatsAppParams {
  telefono:    string;
  tipo:        TipoNotificacion | string;
  variables:   Record<string, string>;
  empresaId?:  string;
  clienteId?:  string;
  contratoId?: string;
  logId?:      string;
}
