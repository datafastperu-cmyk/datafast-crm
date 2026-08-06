import api from '@/lib/api';
import type { Factura, Pago, PaginaRespuesta, PaginaMeta, ApiRespuesta } from '@/types';

// ─── Comprobante dinámico ─────────────────────────────────────
export interface ComprobanteConfigItem {
  id:                string;
  nombre:            string;
  codigo:            string;
  tieneCargaFiscal:  boolean;
  serie:             string;
  correlativoActual: number;
  esDefault:         boolean;
  esProtegido:       boolean;
  activo:            boolean;
}

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
  sortBy?:      string;
  sortOrder?:   'ASC' | 'DESC';
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
  sectorId?:      string;
  routerId?:      string;
  page?:          number;
  limit?:         number;
}

/** Adelanto: pago sin comprobante asignado. La situación se deriva de lo ya imputado. */
export interface AdelantoRow {
  id: string;
  clienteId: string;
  clienteNombre: string;
  monto: number;
  aplicado: number;
  disponible: number;
  metodoPago: string;
  numeroOperacion: string | null;
  fechaPago: string;
  estado: string;
  situacion: 'disponible' | 'parcial' | 'efectuado' | 'devuelto';
  facturasAplicadas: string[];
  createdAt: string;
}

export interface SaldoAFavorResp {
  clienteId: string;
  disponible: number;
  totalAdelantado: number;
  aplicado: number;
  deudaPendiente: number;
  /** El backend resuelve la regla para que la UI no la reimplemente. */
  puedeAdelantar: boolean;
}

export interface RegistrarPagoDto {
  clienteId:       string;
  facturaId?:      string;
  /** Pago consolidado: un solo ingreso salda varios comprobantes. Es todo o nada. */
  facturaIds?:     string[];
  /** Cobro sin comprobante: queda como saldo a favor del abonado. */
  esAdelanto?:     boolean;
  /** `false` = cobrar sin devolver el servicio (baja que salda su último comprobante). */
  reactivarServicio?: boolean;
  contratoId?:     string;
  monto:           number;
  /** El medio concreto por el que entró el dinero. Manda sobre `metodoPago`. */
  canalPagoId?:    string;
  /** Dónde entró. Si no viene, el backend usa la cuenta por defecto del canal. */
  cuentaReceptoraId?: string;
  /** Una por apertura del formulario: impide que un doble clic cree dos cobros. */
  idempotencyKey?: string;
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
  contratoId?:          string;
  comprobanteConfigId?: string;
  periodoInicio?:       string;
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
  version?: number;
}

export interface CreateFacturaDto {
  clienteId:            string;
  contratoId?:          string;
  comprobanteConfigId?: string;
  periodoInicio:        string;
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
  /** Rótulo operativo: "Caja Principal", "BCP Soles". Una caja no tiene banco. */
  nombre?:       string;
  /** `caja` | `banco` | `pasarela` | `virtual` — dónde vive realmente el dinero. */
  tipo?:         string;
  banco?:        string;
  numeroCuenta?: string;
  titular?:      string;
  moneda?:       string;
  activa?:       boolean;
  requiereArqueo?: boolean;
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

  getComprobantes: async (): Promise<ComprobanteConfigItem[]> => {
    const res = await api.get<ApiRespuesta<{ tiposComprobante: ComprobanteConfigItem[] }>>('/facturacion-config');
    return res.data.data?.tiposComprobante ?? [];
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

  // ── Adelantos (saldo a favor) ───────────────────────────────
  listarAdelantos: async (
    params: { clienteId?: string; situacion?: string } = {},
  ): Promise<AdelantoRow[]> => {
    const res = await api.get<ApiRespuesta<AdelantoRow[]>>('/pagos/adelantos', { params });
    return res.data.data ?? [];
  },

  saldoAFavor: async (clienteId: string): Promise<SaldoAFavorResp> => {
    const res = await api.get<ApiRespuesta<SaldoAFavorResp>>(`/pagos/adelantos/saldo/${clienteId}`);
    return res.data.data;
  },

  devolverAdelanto: async (id: string, motivo: string): Promise<{ devuelto: number }> => {
    const res = await api.post<ApiRespuesta<{ devuelto: number }>>(
      `/pagos/adelantos/${id}/devolver`, { motivo },
    );
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

  // ── Catálogos de cobranza (F1/F5) ───────────────────────────
  //
  // La forma es taxonomía cerrada (no configurable); el canal es lo que el negocio
  // configura y lleva su cuenta receptora sugerida, si requiere nº de operación y su
  // comisión. La UI NO decide ninguna de esas reglas: las lee.
  getFormas: async (): Promise<FormaPagoDef[]> => {
    const res = await api.get<ApiRespuesta<FormaPagoDef[]>>('/pagos/formas');
    return res.data.data ?? [];
  },

  // `soloManuales` excluye los canales que solo crea una pasarela: ofrecerlos en la caja
  // permitiría registrar a mano un cobro que el webhook registra solo, y contarlo dos veces.
  getCanales: async (soloManuales = false): Promise<CanalPago[]> => {
    const res = await api.get<ApiRespuesta<CanalPago[]>>('/pagos/canales', {
      params: soloManuales ? { soloManuales: 'true' } : {},
    });
    return res.data.data ?? [];
  },

  crearCanal: async (dto: Partial<CanalPago>): Promise<CanalPago> => {
    const res = await api.post<ApiRespuesta<CanalPago>>('/pagos/canales', dto);
    return res.data.data as CanalPago;
  },

  actualizarCanal: async (id: string, dto: Partial<CanalPago>): Promise<CanalPago> => {
    const res = await api.patch<ApiRespuesta<CanalPago>>(`/pagos/canales/${id}`, dto);
    return res.data.data as CanalPago;
  },

  // Baja LÓGICA: un canal desactivado sale de los selectores, jamás del histórico.
  desactivarCanal: async (id: string): Promise<void> => {
    await api.delete(`/pagos/canales/${id}`);
  },

  // Un pago no se elimina: se extorna, con motivo. Borrarlo dejaría sin rastro dinero
  // que alguien cobró.
  extornar: async (id: string, motivo: string, nota?: string): Promise<Pago> => {
    const res = await api.post<ApiRespuesta<Pago>>(`/pagos/${id}/extornar`, { motivo, nota });
    return res.data.data as Pago;
  },

  getCuentasBancarias: async (): Promise<CuentaBancaria[]> => {
    const res = await api.get<ApiRespuesta<CuentaBancaria[]>>('/pagos/cuentas');
    return res.data.data ?? [];
  },

  uploadComprobante: async (pagoId: string, file: File): Promise<string> => {
    const fd = new FormData();
    fd.append('comprobante', file);
    const res = await api.post<ApiRespuesta<{ comprobanteUrl: string }>>(
      `/pagos/${pagoId}/comprobante`,
      fd,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return res.data.data.comprobanteUrl;
  },

  actualizar: async (
    id:  string,
    dto: { canalPagoId?: string; cuentaReceptoraId?: string; metodoPago?: string; banco?: string; fechaPago?: string; registradoEn?: string; numeroOperacion?: string; notas?: string },
  ): Promise<Pago> => {
    const res = await api.patch<ApiRespuesta<Pago>>(`/pagos/${id}`, dto);
    return res.data.data;
  },

  eliminar: async (id: string): Promise<void> => {
    await api.delete(`/pagos/${id}`);
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

// ── Catálogos de cobranza ─────────────────────────────────────
// Los tres ejes de un ingreso: forma (cómo pagó), canal (por qué medio) y cuenta
// receptora (dónde entró el dinero). El tercero es el que faltaba hasta F1.

/** Taxonomía CERRADA. No la configura el operador: es el eje de los reportes contables. */
export interface FormaPagoDef {
  codigo: string;
  nombre: string;
}

export interface CanalPago {
  id: string;
  codigo: string;
  nombre: string;
  formaPago: string;
  /** La UI la propone; cambiarla es un movimiento de tesorería y exige permiso. */
  cuentaReceptoraDefaultId: string | null;
  /** Quién decide si el nº de operación es obligatorio: el canal, no el frontend. */
  requiereNumeroOperacion: boolean;
  requiereVoucher: boolean;
  comisionPorcentaje: number;
  comisionFija: number;
  /** `false` en canales que solo crea una pasarela — no se ofrecen en la caja manual. */
  permiteRegistroManual: boolean;
  activo: boolean;
  esProtegido: boolean;
}

export const MOTIVOS_EXTORNO = [
  { value: 'error_registro',     label: 'Error al registrar (nuestro)' },
  { value: 'devolucion_cliente', label: 'Devolución al cliente' },
  { value: 'cheque_rebotado',    label: 'Cheque rebotado' },
  { value: 'contracargo',        label: 'Contracargo' },
  { value: 'pago_duplicado',     label: 'Pago duplicado' },
  { value: 'fraude',             label: 'Fraude' },
] as const;
