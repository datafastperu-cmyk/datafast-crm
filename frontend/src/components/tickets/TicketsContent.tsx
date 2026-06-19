'use client';

import { useState, useCallback } from 'react';
import { useRouter }             from 'next/navigation';
import { useQuery }              from '@tanstack/react-query';
import {
  Search, Plus, RefreshCw, Ticket, AlertTriangle,
  Clock, CheckCircle, XCircle, ChevronRight, MessageSquare,
} from 'lucide-react';
import { SortableHeader } from '@/components/ui/SortableHeader';

import {
  ticketsApi,
  ticketLabels, prioridadLabels, categoriaLabels,
  type FiltrosTicket, type EstadoTicket, type PrioridadTicket,
} from '@/lib/api/tickets';
import { useDebounce } from '@/hooks/useDebounce';
import { cn, formatDate } from '@/lib/utils';

// ─── Colores por estado ───────────────────────────────────────
const estadoColors: Record<EstadoTicket, string> = {
  abierto:           'bg-blue-500/15 text-blue-400 border-blue-500/30',
  en_progreso:       'bg-amber-500/15 text-amber-400 border-amber-500/30',
  pendiente_cliente: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  pendiente_tecnico: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  resuelto:          'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  cerrado:           'bg-muted/40 text-muted-foreground border-border',
  cancelado:         'bg-red-500/10 text-red-400 border-red-500/20',
};

const prioridadColors: Record<PrioridadTicket, string> = {
  baja:    'bg-slate-500/15 text-slate-400',
  media:   'bg-blue-500/15 text-blue-400',
  alta:    'bg-amber-500/15 text-amber-400',
  critica: 'bg-red-500/20 text-red-400 font-semibold',
};

const ESTADO_TABS: { key: EstadoTicket | ''; label: string }[] = [
  { key: '',                    label: 'Todos' },
  { key: 'abierto',             label: 'Abiertos' },
  { key: 'en_progreso',         label: 'En progreso' },
  { key: 'pendiente_cliente',   label: 'Pendiente' },
  { key: 'resuelto',            label: 'Resueltos' },
  { key: 'cerrado',             label: 'Cerrados' },
];

interface Props {
  defaultEstado?: EstadoTicket | '';
  title?: string;
}

export function TicketsContent({ defaultEstado = '', title = 'Tickets' }: Props) {
  const router = useRouter();
  const [filtros, setFiltros]    = useState<FiltrosTicket>({ page: 1, limit: 25, estado: defaultEstado || undefined });
  const [searchInput, setSearch] = useState('');
  const searchDebounced          = useDebounce(searchInput, 400);

  const upd = useCallback(<K extends keyof FiltrosTicket>(k: K, v: FiltrosTicket[K]) =>
    setFiltros((f) => ({ ...f, [k]: v, page: 1 })), []);

  const handleSort = useCallback((field: string) => {
    setFiltros((f) => ({
      ...f,
      sortBy:    field,
      sortOrder: f.sortBy === field && f.sortOrder === 'ASC' ? 'DESC' : 'ASC',
      page:      1,
    }));
  }, []);

  const params: FiltrosTicket = {
    ...filtros,
    search: searchDebounced || undefined,
  };

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey:  ['tickets', params],
    queryFn:   () => ticketsApi.getAll(params),
    placeholderData: (p: any) => p,
  });

  const { data: stats } = useQuery({
    queryKey:  ['tickets-stats'],
    queryFn:   ticketsApi.getStats,
    staleTime: 60_000,
  });

  const tickets = (data as any)?.data ?? [];
  const meta    = (data as any)?.meta;

  function slaVencido(t: any): boolean {
    if (!t.fechaLimiteSla) return false;
    if (['resuelto', 'cerrado', 'cancelado'].includes(t.estado)) return false;
    return new Date(t.fechaLimiteSla) < new Date();
  }

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">
            {meta?.total != null
              ? `${meta.total.toLocaleString('es-PE')} tickets`
              : 'Sistema de soporte técnico'}
          </p>
        </div>
        <button
          onClick={() => router.push('/tickets/nuevo')}
          className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg
                     bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Nuevo ticket
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Abiertos',    value: stats.abiertos,    color: 'text-blue-500' },
            { label: 'Críticos',    value: stats.criticos,    color: stats.criticos > 0 ? 'text-red-500' : 'text-muted-foreground' },
            { label: 'SLA vencido', value: stats.slaVencidos, color: stats.slaVencidos > 0 ? 'text-amber-500' : 'text-muted-foreground' },
            { label: 'Este mes',    value: stats.creadosEsteMes, color: 'text-foreground' },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{s.label}</p>
              <p className={cn('text-2xl font-bold tabular-nums', s.color)}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        {/* Estado tabs */}
        <div className="flex flex-wrap gap-1">
          {ESTADO_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => upd('estado', (tab.key as EstadoTicket) || undefined)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                (filtros.estado ?? '') === tab.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search + Prioridad */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={searchInput}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por número, título..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <select
            value={filtros.prioridad ?? ''}
            onChange={(e) => upd('prioridad', (e.target.value as PrioridadTicket) || undefined)}
            className="px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Prioridad</option>
            {Object.entries(prioridadLabels).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <button
            onClick={() => { refetch(); }}
            className={cn('p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors', isFetching && 'animate-spin')}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Cargando...
          </div>
        ) : tickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <Ticket className="w-10 h-10 opacity-30" />
            <p className="text-sm">No hay tickets que coincidan</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <SortableHeader field="numeroTicket"  label="Ticket"   sortField={filtros.sortBy} sortOrder={filtros.sortOrder} onSort={handleSort} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider" />
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Cliente</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Categoría</th>
                  <SortableHeader field="prioridad"     label="Prioridad" sortField={filtros.sortBy} sortOrder={filtros.sortOrder} onSort={handleSort} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider" />
                  <SortableHeader field="estado"        label="Estado"    sortField={filtros.sortBy} sortOrder={filtros.sortOrder} onSort={handleSort} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider" />
                  <SortableHeader field="fechaLimiteSla" label="SLA"      sortField={filtros.sortBy} sortOrder={filtros.sortOrder} onSort={handleSort} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider" />
                  <SortableHeader field="createdAt"     label="Fecha"     sortField={filtros.sortBy} sortOrder={filtros.sortOrder} onSort={handleSort} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider" />
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tickets.map((t: any) => {
                  const vencido = slaVencido(t);
                  return (
                    <tr
                      key={t.id}
                      onClick={() => router.push(`/tickets/${t.id}`)}
                      className="hover:bg-accent/40 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="font-mono text-xs text-primary">{t.numeroTicket}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-[180px] mt-0.5">{t.titulo}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium">{t.clienteNombre ?? '—'}</div>
                        {t.clienteTelefono && (
                          <div className="text-xs text-muted-foreground">{t.clienteTelefono}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-muted-foreground">
                          {categoriaLabels[t.categoria as keyof typeof categoriaLabels] ?? t.categoria}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs', prioridadColors[t.prioridad as PrioridadTicket])}>
                          {prioridadLabels[t.prioridad as PrioridadTicket] ?? t.prioridad}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs border', estadoColors[t.estado as EstadoTicket])}>
                          {ticketLabels[t.estado as EstadoTicket] ?? t.estado}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {t.fechaLimiteSla ? (
                          <span className={cn('flex items-center gap-1 text-xs', vencido ? 'text-red-500' : 'text-muted-foreground')}>
                            <Clock className="w-3 h-3" />
                            {vencido ? 'Vencido' : new Date(t.fechaLimiteSla).toLocaleDateString('es-PE')}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {t.createdAt ? new Date(t.createdAt).toLocaleDateString('es-PE') : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/20">
            <p className="text-xs text-muted-foreground">
              {meta.from}–{meta.to} de {meta.total.toLocaleString()}
            </p>
            <div className="flex gap-1">
              {Array.from({ length: Math.min(meta.totalPages, 5) }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => setFiltros((f) => ({ ...f, page: p }))}
                  className={cn(
                    'w-7 h-7 text-xs rounded font-medium transition-colors',
                    meta.page === p
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent',
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
