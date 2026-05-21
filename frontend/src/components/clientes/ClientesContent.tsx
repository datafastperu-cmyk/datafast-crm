'use client';

import { useState, useCallback } from 'react';
import { useRouter }             from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search, Plus, Download, RefreshCw,
  Users, UserX, UserCheck, AlertTriangle, TrendingUp,
  Filter, X, ChevronDown, Ban, ShieldCheck, Clock, AlertOctagon,
  Loader2,
} from 'lucide-react';
import type { Cliente } from '@/types';
import { parseApiError } from '@/lib/utils';

import { clientesApi, type FiltrosCliente } from '@/lib/api/clientes';
import { ClientesTable }      from './ClientesTable';
import { useToast }           from '@/components/ui/toaster';
import { useDebounce }        from '@/hooks/useDebounce';
import { cn }                 from '@/lib/utils';
import { MOCK_STATS } from '@/data/clientes.mock';

const ESTADO_TABS = [
  { key: '',               label: 'Todos',      color: 'text-foreground' },
  { key: 'activo',         label: 'Activos',    color: 'text-green-600 dark:text-green-400' },
  { key: 'moroso',         label: 'Morosos',    color: 'text-orange-600 dark:text-orange-400' },
  { key: 'suspendido',     label: 'Suspendidos', color: 'text-yellow-600 dark:text-yellow-400' },
  { key: 'baja_definitiva', label: 'Bajas',     color: 'text-muted-foreground' },
  { key: 'prospecto',      label: 'Prospectos', color: 'text-blue-600 dark:text-blue-400' },
] as const;

const SERVICIO_OPTIONS = [
  { value: '',         label: 'Todos los servicios' },
  { value: 'ftth',    label: '📡 FTTH — Fibra' },
  { value: 'wisp',    label: '📶 WISP — Inalámbrico' },
  { value: 'dedicado', label: '🔌 Dedicado' },
  { value: 'mixto',   label: '🔀 Mixto' },
];

export function ClientesContent() {
  const router  = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [filtros, setFiltros]    = useState<FiltrosCliente>({ page: 1, limit: 20 });
  const [searchInput, setSearch] = useState('');
  const [filtersOpen, setFilters] = useState(false);
  const searchDebounced           = useDebounce(searchInput, 400);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modal de confirmación para acciones individuales
  const [accion, setAccion] = useState<{
    tipo: 'suspender' | 'retirar' | 'eliminar';
    cliente: Cliente;
  } | null>(null);

  const updateFiltro = useCallback(<K extends keyof FiltrosCliente>(
    k: K, v: FiltrosCliente[K],
  ) => setFiltros((f) => ({ ...f, [k]: v, page: 1 })), []);

  const filtrosConSearch: FiltrosCliente = {
    ...filtros,
    search: searchDebounced || undefined,
  };

  const queryResult = useQuery({
    queryKey:  ['clientes', filtrosConSearch],
    queryFn:   () => clientesApi.list(filtrosConSearch),
  } as any) as any;
  const { isLoading, isFetching, refetch } = queryResult;
  const data = queryResult.data as { data: any[]; meta: any } | undefined;

  const { data: stats } = useQuery({
    queryKey: ['clientes-stats'],
    queryFn:  clientesApi.getStats,
    staleTime: 60_000,
  });

  const toggleId = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback((ids: string[]) => {
    setSelectedIds((prev) => {
      const allSelected = ids.every((id) => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...prev, ...ids]);
    });
  }, []);

  const { mutate: bulkAction, isPending: bulkPending } = useMutation({
    mutationFn: ({ action, motivo }: { action: 'suspender' | 'reactivar' | 'baja_temporal' | 'marcar_moroso'; motivo?: string }) =>
      clientesApi.bulkAction(Array.from(selectedIds), action, motivo),
    onSuccess: (result) => {
      toast(`${result.ok} clientes actualizados${result.errors ? `, ${result.errors} errores` : ''}`, {
        type: result.errors ? 'warning' : 'success',
      });
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['clientes'] });
      queryClient.invalidateQueries({ queryKey: ['clientes-stats'] });
    },
    onError: () => toast('Error al aplicar acción masiva', { type: 'error' }),
  });

  const invalidarClientes = () => {
    queryClient.invalidateQueries({ queryKey: ['clientes'] });
    queryClient.invalidateQueries({ queryKey: ['clientes-stats'] });
  };

  const { mutate: suspenderUno, isPending: suspendiendo } = useMutation({
    mutationFn: (c: Cliente) => clientesApi.cambiarEstado(c.id, 'suspendido'),
    onSuccess: (_, c) => {
      toast(`${c.nombreCompleto} suspendido`, { type: 'success' });
      setAccion(null);
      invalidarClientes();
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const { mutate: retirarUno, isPending: retirando } = useMutation({
    mutationFn: (c: Cliente) => clientesApi.cambiarEstado(c.id, 'baja_definitiva', 'Retirado del sistema'),
    onSuccess: (_, c) => {
      toast(`${c.nombreCompleto} retirado`, { type: 'success' });
      setAccion(null);
      invalidarClientes();
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const { mutate: eliminarUno, isPending: eliminando } = useMutation({
    mutationFn: (c: Cliente) => clientesApi.eliminar(c.id),
    onSuccess: (_, c) => {
      toast(`${c.nombreCompleto} eliminado`, { type: 'success' });
      setAccion(null);
      invalidarClientes();
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const ejecutarAccion = () => {
    if (!accion) return;
    if (accion.tipo === 'suspender') suspenderUno(accion.cliente);
    else if (accion.tipo === 'retirar') retirarUno(accion.cliente);
    else eliminarUno(accion.cliente);
  };

  const confirmPending = suspendiendo || retirando || eliminando;

  const CONFIRM_CFG = {
    suspender: {
      titulo: 'Suspender abonado',
      desc: 'Se suspenderá el servicio de internet. El abonado quedará clasificado como suspendido.',
      boton: 'Suspender',
      color: 'bg-yellow-500 hover:bg-yellow-600',
    },
    retirar: {
      titulo: 'Retirar abonado',
      desc: 'Se retirará al abonado de los routers MikroTik. Se conservan facturas, estadísticas, logs, mensajes y todos sus datos históricos. El abonado no estará activo.',
      boton: 'Retirar',
      color: 'bg-orange-500 hover:bg-orange-600',
    },
    eliminar: {
      titulo: 'Eliminar abonado',
      desc: 'Se eliminará al abonado con todos sus registros. Esta acción puede deshacerse desde la Papelera.',
      boton: 'Eliminar',
      color: 'bg-destructive hover:bg-destructive/90',
    },
  };

  const { mutate: exportar, isPending: exportando } = useMutation({
    mutationFn: async () => {
      const blob = await clientesApi.exportar(filtrosConSearch, 'csv');
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `clientes-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
    onSuccess: () => toast('Exportación completada', { type: 'success' }),
    onError:   () => toast('Error al exportar', { type: 'error' }),
  });

  const clientes  = (data?.data ?? []) as any[];
  const meta      = data?.meta;
  const statsData = stats ?? MOCK_STATS;

  const STAT_CARDS = [
    {
      label: 'Total abonados',
      value: statsData.total ?? 0,
      icon: Users,
      iconBg: 'bg-blue-100 dark:bg-blue-950/40',
      iconColor: 'text-blue-600 dark:text-blue-400',
      trend: '+12%',
      trendUp: true,
      border: 'border-t-blue-500',
    },
    {
      label: 'Activos',
      value: statsData.activos ?? 0,
      icon: UserCheck,
      iconBg: 'bg-green-100 dark:bg-green-950/40',
      iconColor: 'text-green-600 dark:text-green-400',
      trend: '+5.2%',
      trendUp: true,
      border: 'border-t-green-500',
    },
    {
      label: 'Morosos',
      value: statsData.morosos ?? 0,
      icon: AlertTriangle,
      iconBg: 'bg-orange-100 dark:bg-orange-950/40',
      iconColor: 'text-orange-600 dark:text-orange-400',
      trend: '-2.1%',
      trendUp: false,
      border: 'border-t-orange-500',
    },
    {
      label: 'Bajas',
      value: statsData.baja ?? 0,
      icon: UserX,
      iconBg: 'bg-red-100 dark:bg-red-950/40',
      iconColor: 'text-red-500 dark:text-red-400',
      trend: '+0.8%',
      trendUp: false,
      border: 'border-t-red-500',
    },
  ];

  const hasActiveFilters = !!(filtros.tipoServicio || filtros.estado);

  return (
    <div className="space-y-6">

      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight">Abonados</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {meta?.total != null
              ? `${meta.total.toLocaleString('es-PE')} abonados registrados`
              : 'Gestión de abonados y contratos de servicio'}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => exportar()}
            disabled={exportando}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-border
                       text-muted-foreground hover:text-foreground hover:bg-accent
                       transition-all duration-150 disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            {exportando ? 'Exportando…' : 'Exportar CSV'}
          </button>
          <button
            onClick={() => router.push('/clientes/nuevo')}
            className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg font-medium
                       bg-primary text-primary-foreground hover:bg-primary/90
                       transition-all duration-150 shadow-sm hover:shadow-md"
          >
            <Plus className="w-4 h-4" />
            Nuevo abonado
          </button>
        </div>
      </div>

      {/* ── Stat Cards ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {STAT_CARDS.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              className={cn(
                'bg-card border border-border rounded-xl p-4 border-t-2 transition-all duration-150',
                'hover:shadow-md hover:-translate-y-0.5 cursor-default',
                s.border,
              )}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium mb-1">{s.label}</p>
                  <p className="text-2xl font-bold text-foreground">
                    {s.value.toLocaleString('es-PE')}
                  </p>
                </div>
                <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center', s.iconBg)}>
                  <Icon className={cn('w-4.5 h-4.5', s.iconColor)} />
                </div>
              </div>
              <div className={cn(
                'flex items-center gap-1 mt-2 text-xs font-medium',
                s.trendUp ? 'text-green-600 dark:text-green-400' : 'text-red-500',
              )}>
                <TrendingUp className={cn('w-3 h-3', !s.trendUp && 'rotate-180')} />
                {s.trend} vs mes anterior
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Tabla container ──────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-4 border-b border-border">

          {/* Search */}
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar nombre, DNI, teléfono…"
              value={searchInput}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-8 py-2 text-sm rounded-lg border border-input
                         bg-background placeholder:text-muted-foreground
                         focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent
                         transition-all duration-150"
            />
            {searchInput && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Filters toggle */}
          <button
            onClick={() => setFilters(!filtersOpen)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition-all duration-150',
              filtersOpen || hasActiveFilters
                ? 'border-primary text-primary bg-primary/5'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent',
            )}
          >
            <Filter className="w-3.5 h-3.5" />
            Filtros
            {hasActiveFilters && (
              <span className="w-4 h-4 text-[10px] font-bold bg-primary text-primary-foreground rounded-full flex items-center justify-center">
                {(filtros.tipoServicio ? 1 : 0) + (filtros.estado ? 1 : 0)}
              </span>
            )}
            <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', filtersOpen && 'rotate-180')} />
          </button>

          {hasActiveFilters && (
            <button
              onClick={() => { updateFiltro('tipoServicio', undefined); updateFiltro('estado', undefined); }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
            >
              <X className="w-3 h-3" />
              Limpiar
            </button>
          )}

          <div className="sm:ml-auto flex items-center gap-2">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="p-2 rounded-lg border border-border text-muted-foreground
                         hover:text-foreground hover:bg-accent transition-all duration-150 disabled:opacity-40"
              title="Actualizar"
            >
              <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
            </button>
          </div>
        </div>

        {/* Expanded filters */}
        {filtersOpen && (
          <div className="px-4 py-3 border-b border-border bg-muted/30 flex flex-wrap gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                Tipo de servicio
              </label>
              <select
                value={filtros.tipoServicio ?? ''}
                onChange={(e) => updateFiltro('tipoServicio', e.target.value || undefined)}
                className="text-sm rounded-lg border border-input bg-background px-3 py-1.5
                           focus:outline-none focus:ring-2 focus:ring-primary min-w-[180px]"
              >
                {SERVICIO_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Status tabs */}
        <div className="flex items-center gap-0.5 px-4 border-b border-border overflow-x-auto">
          {ESTADO_TABS.map(({ key, label, color }) => {
            const active = (filtros.estado ?? '') === key;
            return (
              <button
                key={key}
                onClick={() => updateFiltro('estado', key || undefined)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-3 text-xs font-medium whitespace-nowrap',
                  'border-b-2 transition-all duration-150',
                  active
                    ? `border-primary ${color}`
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
                )}
              >
                {label}
                {active && meta?.total != null && (
                  <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded-full text-[10px] font-bold">
                    {meta.total}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-primary/5 border-b border-primary/20 flex-wrap">
            <span className="text-xs font-semibold text-primary">
              {selectedIds.size} seleccionados
            </span>
            <div className="w-px h-4 bg-border mx-1" />
            <button
              onClick={() => bulkAction({ action: 'suspender' })}
              disabled={bulkPending}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg font-medium
                         bg-yellow-100 text-yellow-700 hover:bg-yellow-200 dark:bg-yellow-950/40
                         dark:text-yellow-400 dark:hover:bg-yellow-900/40 transition-colors disabled:opacity-50"
            >
              <Ban className="w-3.5 h-3.5" />
              Suspender
            </button>
            <button
              onClick={() => bulkAction({ action: 'reactivar' })}
              disabled={bulkPending}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg font-medium
                         bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-950/40
                         dark:text-green-400 dark:hover:bg-green-900/40 transition-colors disabled:opacity-50"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Reactivar
            </button>
            <button
              onClick={() => bulkAction({ action: 'marcar_moroso' })}
              disabled={bulkPending}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg font-medium
                         bg-orange-100 text-orange-700 hover:bg-orange-200 dark:bg-orange-950/40
                         dark:text-orange-400 dark:hover:bg-orange-900/40 transition-colors disabled:opacity-50"
            >
              <AlertOctagon className="w-3.5 h-3.5" />
              Marcar moroso
            </button>
            <button
              onClick={() => bulkAction({ action: 'baja_temporal' })}
              disabled={bulkPending}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg font-medium
                         bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800
                         dark:text-gray-400 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              <Clock className="w-3.5 h-3.5" />
              Baja temporal
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Deseleccionar
            </button>
          </div>
        )}

        {/* Table */}
        <ClientesTable
          clientes={clientes}
          loading={isLoading}
          onRowClick={(c) => router.push(`/clientes/${c.id}`)}
          sortBy={filtros.orderBy}
          sortOrder={filtros.order}
          onSort={(col, dir) => { updateFiltro('orderBy', col); updateFiltro('order', dir); }}
          selectedIds={selectedIds}
          onToggleId={toggleId}
          onToggleAll={toggleAll}
          onSuspender={(c) => setAccion({ tipo: 'suspender', cliente: c as Cliente })}
          onRetirar={(c)   => setAccion({ tipo: 'retirar',   cliente: c as Cliente })}
          onEliminar={(c)  => setAccion({ tipo: 'eliminar',  cliente: c as Cliente })}
        />

        {/* Pagination */}
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <p className="text-xs text-muted-foreground">
              Mostrando {((meta.page - 1) * meta.limit) + 1}–
              {Math.min(meta.page * meta.limit, meta.total)} de{' '}
              {meta.total.toLocaleString('es-PE')}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => updateFiltro('page', meta.page - 1)}
                disabled={!meta.hasPrev}
                className="px-3 py-1.5 text-xs rounded-lg border border-input
                           disabled:opacity-40 hover:bg-accent transition-colors"
              >
                Anterior
              </button>
              {Array.from({ length: Math.min(meta.totalPages, 7) }, (_, i) => {
                const page = i + 1;
                return (
                  <button
                    key={page}
                    onClick={() => updateFiltro('page', page)}
                    className={cn(
                      'w-8 h-8 text-xs rounded-lg border transition-colors',
                      meta.page === page
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-input hover:bg-accent',
                    )}
                  >
                    {page}
                  </button>
                );
              })}
              <button
                onClick={() => updateFiltro('page', meta.page + 1)}
                disabled={!meta.hasNext}
                className="px-3 py-1.5 text-xs rounded-lg border border-input
                           disabled:opacity-40 hover:bg-accent transition-colors"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>
      {/* Modal confirmación acción individual */}
      {accion && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div>
              <p className="font-semibold text-foreground">{CONFIRM_CFG[accion.tipo].titulo}</p>
              <p className="text-sm font-medium text-primary mt-0.5">{accion.cliente.nombreCompleto}</p>
              <p className="text-sm text-muted-foreground mt-2">{CONFIRM_CFG[accion.tipo].desc}</p>
            </div>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setAccion(null)}
                disabled={confirmPending}
                className="flex-1 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={ejecutarAccion}
                disabled={confirmPending}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-lg text-white font-medium transition-colors disabled:opacity-60',
                  CONFIRM_CFG[accion.tipo].color,
                )}
              >
                {confirmPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {CONFIRM_CFG[accion.tipo].boton}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
