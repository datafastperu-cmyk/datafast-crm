import api from '@/lib/api';
import type { Factura, Pago, PaginaRespuesta, PaginaMeta, ApiRespuesta } from '@/types';

// ─── Filtros ──────────────────────────────────────────────────
export interface FiltrosFactura {
  search?:      string;
  estado?:      string;
  clienteId?:   string;
  contratoId?:  string;
  mes?:         number;
  anio?:        number;
  fechaDesde?:  string;
  fechaHasta?:  string;
  page?:        number;
  limit?:       number;
  orderBy?:     string;
  order?:       'ASC' | 'DESC';
}

export interface FiltrosPago {
  search?:        string;
  estado?:        string;
  metodoPago?:    string;
  clienteId?:     string;
  facturaId?:     string;
  soloHoy?:       boolean;
  conciliado?:    boolean;
  fechaDesde?:    string;
  fechaHasta?:    string;
  page?:          number;
  limit?:         number;
}

export interface RegistrarPagoDto {
  clienteId:       string;
  facturaId?:      string;
  contratoId?:     string;
  monto:           number;
  metodoPago:      string;
  banco?:          string;
  numeroOperacion?: string;
  numeroCuenta?:   string;
  fechaPago?:      string;
  notas?:          string;
  comprobanteUrl?: string;
  autoVerificar?:  boolean;
  moneda?:         string;
}

export interface UpdateFacturaDto {
  contratoId?:       string;
  tipoComprobante?:  'boleta' | 'factura' | 'recibo_interno';
  periodoInicio?:    string;
  periodoFin?:       string;
  descripcion?:      string;
  fechaVencimiento?: string;
  aplicaIgv?:        boolean;
  items?: {
    descripcion:    string;
    cantidad:       number;
    precioUnitario: number;
    descuento?:     number;
  }[];
}

export interface CreateFacturaDto {
  clienteId:         string;
  contratoId?:       string;
  tipoComprobante?:  'boleta' | 'factura' | 'recibo_interno';
  periodoInicio:     string;
  periodoFin:        string;
  descripcion?:      string;
  items?: {
    descripcion:     string;
    cantidad:        number;
    precioUnitario:  number;
    descuento?:      number;
  }[];
  subtotal?:         number;
  descuento?:        number;
  fechaVencimiento?: string;
  aplicaIgv?:        boolean;
  moneda?:           string;
}

export interface GenerarMensualDto {
  mes:          number;
  anio:         number;
  contratoId?:  string;
  forzar?:      boolean;
}

export interface ResumenCobranza {
  cobradoHoy:          number;
  cobradoSemana:       number;
  cobradoMes:          number;
  cobradoMesAnterior:  number;
  pagosHoy:            number;
  pagosSemana:         number;
  pagosMes:            number;
  pendientesVerificar: number;
  porMetodo:           Record<string, { total: number; monto: number }>;
  ultimosPagos:        Pago[];
}

export interface CuentaBancaria {
  id:            string;
  banco:         string;
  numeroCuenta?: string;
  titular?:      string;
  moneda?:       string;
  activa?:       boolean;
}

// ─── Facturación API ──────────────────────────────────────────
export const facturacionApi = {

  list: async (filtros: FiltrosFactura = {}): Promise<PaginaRespuesta<Factura>> => {
    const res = await api.get<ApiRespuesta<Factura[]>>('/facturacion', { params: filtros });
    return { data: res.data.data ?? [], meta: res.data.meta?.['meta'] as PaginaMeta };
  },

  create: async (dto: CreateFacturaDto): Promise<Factura> => {
    const res = await api.post<ApiRespuesta<Factura>>('/facturacion', dto);
    return res.data.data;
  },

  getById: async (id: string): Promise<Factura> => {
    const res = await api.get<ApiRespuesta<Factura>>(`/facturacion/${id}`);
    return res.data.data;
  },

  getPdf: async (id: string): Promise<Blob> => {
    const res = await api.get(`/facturacion/${id}/pdf`, { responseType: 'blob' });
    return res.data;
  },

  getByCliente: async (clienteId: string): Promise<Factura[]> => {
    const res = await api.get<ApiRespuesta<Factura[]>>(`/facturacion/cliente/${clienteId}`);
    return res.data.data ?? [];
  },

  update: async (id: string, dto: UpdateFacturaDto): Promise<Factura> => {
    const res = await api.patch<ApiRespuesta<Factura>>(`/facturacion/${id}`, dto);
    return res.data.data;
  },

  eliminar: async (id: string): Promise<void> => {
    await api.delete(`/facturacion/${id}`);
  },

  anular: async (id: string, motivo: string): Promise<Factura> => {
    const res = await api.patch<ApiRespuesta<Factura>>(`/facturacion/${id}/anular`, { motivo });
    return res.data.data;
  },

  generarMensual: async (dto: GenerarMensualDto): Promise<{ exitosas: number; errores: number }> => {
    const res = await api.post<ApiRespuesta<{ exitosas: number; errores: number }>>('/facturacion/generar-mensual', dto);
    return res.data.data;
  },

  getResumen: async (): Promise<{
    totalEmitidas: number; totalPagadas: number;
    totalVencidas: number; montoTotal: number; montoPendiente: number;
  }> => {
    const res = await api.get<ApiRespuesta<{ totalEmitidas: number; totalPagadas: number; totalVencidas: number; montoTotal: number; montoPendiente: number }>>('/facturacion/resumen');
    return res.data.data;
  },

  getPagos: async (facturaId: string): Promise<Pago[]> => {
    const res = await api.get<ApiRespuesta<Pago[]>>(`/pagos/factura/${facturaId}`);
    return res.data.data ?? [];
  },

  crearPreferenciaMp: async (facturaId: string): Promise<{
    id: string; init_point: string; sandbox_init_point: string;
  }> => {
    const res = await api.post<ApiRespuesta<{ id: string; init_point: string; sandbox_init_point: string }>>(
      '/pagos/mercadopago/preferencia',
      { facturaId },
    );
    return res.data.data;
  },
};

// ─── Pagos API ────────────────────────────────────────────────
export const pagosApi = {

  list: async (filtros: FiltrosPago = {}): Promise<PaginaRespuesta<Pago>> => {
    const res = await api.get<ApiRespuesta<Pago[]>>('/pagos', { params: filtros });
    return { data: res.data.data ?? [], meta: res.data.meta?.['meta'] as PaginaMeta };
  },

  getById: async (id: string): Promise<Pago> => {
    const res = await api.get<ApiRespuesta<Pago>>(`/pagos/${id}`);
    return res.data.data;
  },

  registrar: async (dto: RegistrarPagoDto): Promise<Pago> => {
    const res = await api.post<ApiRespuesta<Pago>>('/pagos', dto);
    return res.data.data;
  },

  verificar: async (id: string, aprobado: boolean, motivoRechazo?: string): Promise<Pago> => {
    const res = await api.patch<ApiRespuesta<Pago>>(`/pagos/${id}/verificar`, {
      aprobado, motivoRechazo,
    });
    return res.data.data;
  },

  conciliar: async (id: string, extractoBancoRef: string): Promise<Pago> => {
    const res = await api.patch<ApiRespuesta<Pago>>(`/pagos/${id}/conciliar`, {
      extractoBancoRef,
    });
    return res.data.data;
  },

  getPendientes: async (): Promise<Pago[]> => {
    const res = await api.get<ApiRespuesta<Pago[]>>('/pagos/pendientes');
    return res.data.data ?? [];
  },

  getResumen: async (): Promise<ResumenCobranza> => {
    const res = await api.get<ApiRespuesta<ResumenCobranza>>('/pagos/resumen');
    return res.data.data;
  },

  getPorCliente: async (clienteId: string): Promise<Pago[]> => {
    const res = await api.get<ApiRespuesta<Pago[]>>(`/pagos/cliente/${clienteId}`);
    return res.data.data ?? [];
  },

  getCuentasBancarias: async (): Promise<CuentaBancaria[]> => {
    const res = await api.get<ApiRespuesta<CuentaBancaria[]>>('/pagos/cuentas');
    return res.data.data ?? [];
  },
};

// ─── Utilidades ───────────────────────────────────────────────
export const METODOS_PAGO = [
  { value: 'efectivo',              label: '💵 Efectivo' },
  { value: 'yape',                  label: '🟣 Yape' },
  { value: 'plin',                  label: '🔵 Plin' },
  { value: 'transferencia_bancaria',label: '🏦 Transferencia bancaria' },
  { value: 'deposito_bancario',     label: '🏦 Depósito bancario' },
  { value: 'mercadopago',           label: '💳 MercadoPago' },
  { value: 'tarjeta_credito',       label: '💳 Tarjeta de crédito' },
  { value: 'tarjeta_debito',        label: '💳 Tarjeta de débito' },
  { value: 'cheque',                label: '📄 Cheque' },
  { value: 'otro',                  label: '• Otro' },
] as const;

export const REQUIERE_NUM_OPERACION = new Set([
  'yape', 'plin', 'transferencia_bancaria', 'deposito_bancario',
]);

export type MetodoPagoKey = typeof METODOS_PAGO[number]['value'];
