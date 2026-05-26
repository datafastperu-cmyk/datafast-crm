'use client';

import {
  ChevronUp, ChevronDown, ChevronsUpDown,
  Phone, MessageCircle, Wifi, Radio, Cable, Shuffle,
  Pencil, Trash2, PauseCircle, UserMinus, Eye,
} from 'lucide-react';

import { ClienteEstadoBadge } from './ClienteEstadoBadge';
import { formatDate, cn }     from '@/lib/utils';
import type { Cliente }       from '@/types';
import type { ClienteRich }   from '@/data/clientes.mock';

interface Props {
  clientes:    (Cliente | ClienteRich)[];
  loading:     boolean;
  onRowClick:  (c: Cliente) => void;
  sortBy?:     string;
  sortOrder?:  'ASC' | 'DESC';
  onSort:      (col: string, dir: 'ASC' | 'DESC') => void;
  selectedIds?: Set<string>;
  onToggleId?:  (id: string) => void;
  onToggleAll?: (ids: string[]) => void;
  onSuspender?: (c: Cliente) => void;
  onRetirar?:   (c: Cliente) => void;
  onEliminar?:  (c: Cliente) => void;
}

// ── Servicio badge ────────────────────────────────────────────
const SERVICIO_CFG: Record<string, {
  label: string; icon: React.ElementType;
  bg: string; text: string; dot: string;
}> = {
  ftth: {
    label: 'FTTH',
    icon: Radio,
    bg:   'bg-blue-100 dark:bg-blue-950/40',
    text: 'text-blue-700 dark:text-blue-400',
    dot:  'bg-blue-500',
  },
  wisp: {
    label: 'WISP',
    icon: Wifi,
    bg:   'bg-purple-100 dark:bg-purple-950/40',
    text: 'text-purple-700 dark:text-purple-400',
    dot:  'bg-purple-500',
  },
  dedicado: {
    label: 'Dedicado',
    icon: Cable,
    bg:   'bg-emerald-100 dark:bg-emerald-950/40',
    text: 'text-emerald-700 dark:text-emerald-400',
    dot:  'bg-emerald-500',
  },
  mixto: {
    label: 'Mixto',
    icon: Shuffle,
    bg:   'bg-orange-100 dark:bg-orange-950/40',
    text: 'text-orange-700 dark:text-orange-400',
    dot:  'bg-orange-500',
  },
};

// ── Estado dot color ──────────────────────────────────────────
const ESTADO_DOT: Record<string, string> = {
  activo:          'bg-green-500 shadow-[0_0_0_2px_rgba(34,197,94,0.3)]',
  moroso:          'bg-orange-500 shadow-[0_0_0_2px_rgba(249,115,22,0.3)]',
  suspendido:      'bg-yellow-400 shadow-[0_0_0_2px_rgba(250,204,21,0.3)]',
  suspendido_mora: 'bg-orange-500',
  baja_temporal:   'bg-gray-400',
  baja_definitiva: 'bg-red-500 shadow-[0_0_0_2px_rgba(239,68,68,0.3)]',
  prospecto:       'bg-blue-500 shadow-[0_0_0_2px_rgba(59,130,246,0.3)]',
};

// ── Avatar initials color ─────────────────────────────────────
const AVATAR_COLORS = [
  'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  'bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
];

function avatarColor(name: string) {
  const sum = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

function initials(name: string) {
  const parts = name.trim().split(' ');
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

// ── Sort icon ─────────────────────────────────────────────────
function SortIcon({ col, sortBy, sortOrder }: {
  col: string; sortBy?: string; sortOrder?: 'ASC' | 'DESC';
}) {
  if (sortBy !== col) return <ChevronsUpDown className="w-3 h-3 opacity-30" />;
  return sortOrder === 'ASC'
    ? <ChevronUp   className="w-3 h-3 text-primary" />
    : <ChevronDown className="w-3 h-3 text-primary" />;
}

const COLUMNAS = [
  { key: 'nombreCompleto',  label: 'Abonado',     sortable: true  },
  { key: 'telefono',        label: 'Contacto',    sortable: false },
  { key: 'tipoServicio',    label: 'Servicio',    sortable: true  },
  { key: 'plan',            label: 'Plan / IP',   sortable: false },
  { key: 'estado',          label: 'Estado',      sortable: true  },
  { key: 'deuda',           label: 'Deuda',       sortable: false },
  { key: 'createdAt',       label: 'Alta',        sortable: true  },
  { key: 'acciones',        label: '',            sortable: false },
];

export function ClientesTable({ clientes, loading, onRowClick, sortBy, sortOrder, onSort, selectedIds, onToggleId, onToggleAll, onSuspender, onRetirar, onEliminar }: Props) {
  const allSelected = selectedIds != null && clientes.length > 0 && clientes.every(c => selectedIds.has((c as any).id));
  const someSelected = selectedIds != null && clientes.some(c => selectedIds.has((c as any).id));
  const handleSort = (col: string) => {
    onSort(col, sortBy === col && sortOrder === 'ASC' ? 'DESC' : 'ASC');
  };

  // ── Skeleton ──────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-4 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-2 animate-pulse">
            <div className="skeleton w-10 h-10 rounded-xl flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-3.5 w-44 rounded" />
              <div className="skeleton h-3 w-28 rounded" />
            </div>
            <div className="skeleton h-6 w-16 rounded-full" />
            <div className="skeleton h-6 w-24 rounded-lg" />
            <div className="skeleton h-6 w-16 rounded-full" />
            <div className="skeleton h-3 w-20 rounded" />
          </div>
        ))}
      </div>
    );
  }

  // ── Empty ────────────────────────────────────────────────
  if (!clientes.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
          <Wifi className="w-7 h-7 text-muted-foreground" />
        </div>
        <p className="text-sm font-semibold text-foreground">Sin abonados</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">
          No se encontraron abonados con los filtros actuales. Intenta con otros términos.
        </p>
      </div>
    );
  }

  // ── Desktop table ────────────────────────────────────────
  return (
    <>
      {/* Table — hidden on mobile */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {onToggleAll && (
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={() => onToggleAll(clientes.map((c) => (c as any).id))}
                    className="rounded border-border cursor-pointer accent-primary"
                  />
                </th>
              )}
              {COLUMNAS.map((col) => (
                <th
                  key={col.key}
                  className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider"
                >
                  {col.sortable ? (
                    <button
                      onClick={() => handleSort(col.key)}
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                    >
                      {col.label}
                      <SortIcon col={col.key} sortBy={sortBy} sortOrder={sortOrder} />
                    </button>
                  ) : col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {clientes.map((cliente) => {
              const c = cliente as ClienteRich;
              const svcCfg = SERVICIO_CFG[c.tipoServicio ?? ''];
              const dot    = ESTADO_DOT[c.estado] ?? 'bg-gray-400';
              const avClr  = avatarColor(c.nombreCompleto);

              return (
                <tr
                  key={c.id}
                  onClick={() => onRowClick(c)}
                  className={cn(
                    'group cursor-pointer hover:bg-accent/50 transition-colors duration-100',
                    selectedIds?.has(c.id) && 'bg-primary/5',
                  )}
                >
                  {onToggleId && (
                    <td className="px-4 py-3 w-10" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds?.has(c.id) ?? false}
                        onChange={() => onToggleId(c.id)}
                        className="rounded border-border cursor-pointer accent-primary"
                      />
                    </td>
                  )}
                  {/* Cliente */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="relative flex-shrink-0">
                        <div className={cn(
                          'w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm',
                          avClr,
                        )}>
                          {initials(c.nombreCompleto)}
                        </div>
                        <span className={cn(
                          'absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card',
                          dot,
                        )} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate max-w-[180px]">
                          {c.nombreCompleto}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {c.tipoDocumento?.toUpperCase()} {c.numeroDocumento}
                          {c.codigoCliente && ` · ${c.codigoCliente}`}
                        </p>
                      </div>
                    </div>
                  </td>

                  {/* Contacto */}
                  <td className="px-4 py-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5 text-xs text-foreground">
                        <Phone className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                        {c.telefono}
                      </div>
                      {c.whatsapp && (
                        <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                          <MessageCircle className="w-3 h-3 flex-shrink-0" />
                          WhatsApp
                        </div>
                      )}
                    </div>
                  </td>

                  {/* Servicio */}
                  <td className="px-4 py-3">
                    {svcCfg ? (
                      <span className={cn(
                        'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold',
                        svcCfg.bg, svcCfg.text,
                      )}>
                        <svcCfg.icon className="w-3 h-3" />
                        {svcCfg.label}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>

                  {/* Plan / IP */}
                  <td className="px-4 py-3">
                    <div className="space-y-0.5">
                      {c.planNombre && (
                        <p className="text-xs font-medium text-foreground truncate max-w-[160px]">
                          {c.planNombre}
                        </p>
                      )}
                      {c.ipAsignada && (
                        <p className="text-xs font-mono text-muted-foreground">
                          {c.ipAsignada}
                        </p>
                      )}
                    </div>
                  </td>

                  {/* Estado */}
                  <td className="px-4 py-3">
                    <ClienteEstadoBadge estado={c.estado} />
                  </td>

                  {/* Deuda */}
                  <td className="px-4 py-3">
                    {(c.deudaTotal ?? 0) > 0 ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold
                                       bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400">
                        S/. {(c.deudaTotal ?? 0).toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>

                  {/* Alta */}
                  <td className="px-4 py-3">
                    <span className="text-xs text-muted-foreground">
                      {formatDate(c.createdAt)}
                    </span>
                  </td>

                  {/* Acciones */}
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => onRowClick(c)}
                        title="Editar"
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onSuspender?.(c)}
                        title="Suspender servicio"
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-yellow-600 hover:bg-yellow-500/10 transition-colors"
                      >
                        <PauseCircle className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onRetirar?.(c)}
                        title="Retirar abonado (conserva datos)"
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-orange-600 hover:bg-orange-500/10 transition-colors"
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onEliminar?.(c)}
                        disabled={c.estado !== 'baja_definitiva'}
                        title={c.estado === 'baja_definitiva' ? 'Eliminar abonado' : 'Solo se puede eliminar abonados en Baja Definitiva'}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Mobile cards ──────────────────────────────────── */}
      <div className="md:hidden divide-y divide-border">
        {clientes.map((cliente) => {
          const c      = cliente as ClienteRich;
          const svcCfg = SERVICIO_CFG[c.tipoServicio ?? ''];
          const dot    = ESTADO_DOT[c.estado] ?? 'bg-gray-400';
          const avClr  = avatarColor(c.nombreCompleto);

          return (
            <div
              key={c.id}
              onClick={() => onRowClick(c)}
              className="flex items-center gap-3 px-4 py-3.5 cursor-pointer
                         hover:bg-accent/50 active:bg-accent transition-colors"
            >
              <div className="relative flex-shrink-0">
                <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center font-bold text-sm', avClr)}>
                  {initials(c.nombreCompleto)}
                </div>
                <span className={cn('absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card', dot)} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-semibold text-foreground truncate max-w-[160px]">
                    {c.nombreCompleto}
                  </p>
                  <ClienteEstadoBadge estado={c.estado} />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground">{c.telefono}</span>
                  {svcCfg && (
                    <span className={cn(
                      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold',
                      svcCfg.bg, svcCfg.text,
                    )}>
                      {svcCfg.label}
                    </span>
                  )}
                  {(c.deudaTotal ?? 0) > 0 && (
                    <span className="text-[10px] font-bold text-red-600">
                      Deuda S/. {(c.deudaTotal ?? 0).toFixed(2)}
                    </span>
                  )}
                </div>
              </div>

              <Eye className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            </div>
          );
        })}
      </div>
    </>
  );
}
