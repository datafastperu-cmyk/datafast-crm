import { type ClassValue, clsx }  from 'clsx';
import { twMerge }                from 'tailwind-merge';

/** Combina clases de Tailwind sin conflictos */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formatear moneda peruana */
export function formatPEN(amount: number | null | undefined): string {
  const n = Number(amount);
  if (!isFinite(n)) return 'S/ 0.00';
  return new Intl.NumberFormat('es-PE', {
    style:                 'currency',
    currency:              'PEN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** Parsea un string de fecha sin perder un día por UTC midnight.
 *  "YYYY-MM-DD" lo trata como hora local; ISO con zona lo deja tal cual. */
function parseDate(dateStr: string): Date {
  // Date-only strings (10 chars) son UTC midnight en JS → agregar T00:00:00 para hora local
  return new Date(dateStr.length === 10 ? dateStr + 'T00:00:00' : dateStr);
}

/** Formatear fecha en español */
export function formatDate(dateStr: string, opts?: Intl.DateTimeFormatOptions): string {
  try {
    return parseDate(dateStr).toLocaleDateString('es-PE', {
      day:   '2-digit',
      month: '2-digit',
      year:  'numeric',
      ...opts,
    });
  } catch {
    return dateStr;
  }
}

/** Formatear fecha y hora */
export function formatDateTime(dateStr: string): string {
  try {
    return parseDate(dateStr).toLocaleString('es-PE', {
      day:    '2-digit',
      month:  '2-digit',
      year:   'numeric',
      hour:   '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

/** Formatear bps a Mbps/Gbps */
export function formatBps(bps: number): string {
  if (!bps || bps === 0) return '0 bps';
  if (bps >= 1e9)  return `${(bps / 1e9).toFixed(2)} Gbps`;
  if (bps >= 1e6)  return `${(bps / 1e6).toFixed(2)} Mbps`;
  if (bps >= 1e3)  return `${(bps / 1e3).toFixed(2)} Kbps`;
  return `${bps} bps`;
}

/** Formatear porcentaje */
export function formatPct(val: number, decimals = 1): string {
  return `${val.toFixed(decimals)}%`;
}

/** Abreviar número: 1234 → 1.2K, 1234567 → 1.2M */
export function abrevNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Nombre del mes en español */
export function mesNombre(mes: number): string {
  return ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
          'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'][mes] || '';
}

/** Clase CSS del badge según estado de contrato */
export function badgeContrato(estado: string): string {
  const map: Record<string, string> = {
    pendiente_activacion: 'badge-pendiente',
    activo:               'badge-activo',
    suspendido:           'badge-suspendido',
    baja_definitiva:      'badge-baja',
  };
  return map[estado] ?? 'badge-pendiente';
}

/** Texto del estado de contrato */
export function labelContrato(estado: string): string {
  const map: Record<string, string> = {
    pendiente_activacion: 'Pend. Activación',
    activo:                'Activo',
    suspendido:            'Suspendido',
    baja_definitiva:       'Baja definitiva',
  };
  return map[estado] ?? estado;
}

/** Truncar texto */
export function truncate(str: string, max = 40): string {
  if (!str) return '';
  return str.length > max ? `${str.slice(0, max)}…` : str;
}
export { parseApiError } from './api';
