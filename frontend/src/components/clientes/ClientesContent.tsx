'use client';

import { useState, useCallback }  from 'react';
import { useRouter }              from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search, Plus, Download, Filter,
  RefreshCw, Users, UserX, UserCheck, AlertTriangle,
} from 'lucide-react';

import { clientesApi, type FiltrosCliente } from '@/lib/api/clientes';
import { ClientesTable }    from './ClientesTable';
import { ClienteEstadoBadge } from './ClienteEstadoBadge';
import { useToast }         from '@/components/ui/toaster';
import { useDebounce }      from '@/hooks/useDebounce';
import { cn }               from '@/lib/utils';
import type { Cliente }     from '@/types';

// ─── Stats rápidas en el header ──────────────────────────────
const ESTADO_TABS = [
  { key: '',              label: 'Todos',     icon: Users },
  { key: 'activo',        label: 'Activos',   icon: UserCheck },
  { key: 'suspendido_mora', label: 'Morosos', icon: AlertTriangle },
  { key: 'baja_definitiva', label: 'Baja',   icon: UserX },
] as const;

export function ClientesContent() {
  const router       = useRouter();
  const queryClient  = useQueryClient();
  const { toast }    = useToast();

  // ── Filtros ─────────────────────────────────────────────────
  const [filtros, setFiltros]   = useState<FiltrosCliente>({ page: 1, limit: 20 });
  const [searchInput, setSearch] = useState('');
  const searchDebounced          = useDebounce(searchInput, 400);

  const updateFiltro = useCallback(<K extends keyof FiltrosCliente>(
    k: K, v: FiltrosCliente[K],
  ) => setFiltros((f) => ({ ...f, [k]: v, page: 1 })), []);

  // Sincronizar búsqueda debounced
  const filtrosConSearch: FiltrosCliente = {
    ...filtros,
    search: searchDebounced || undefined,
  };

  // ── Query ───────────────────────────────────────────────────
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey:  ['clientes', filtrosConSearch],
    queryFn:   () => clientesApi.list(filtrosConSearch),
    keepPreviousData: true,
  });

  const { data: stats } = useQuery({
    queryKey: ['clientes-stats'],
    queryFn:  clientesApi.getStats,
    staleTime: 60_000,
  });

  // ── Exportar ─────────────────────────────────────────────────
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

  const clientes = data?.data ?? [];
  const meta     = data?.meta;

  return (
    <div className="space-y-5">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Clientes</h2>
          <p className="text-sm text-muted-foreground">
            {meta?.total != null
              ? `${meta.total.toLocaleString('es-PE')} clientes registrados`
              : 'Gestión de clientes y contratos'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportar()}
            disabled={exportando}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-border
                       text-muted-foreground hover:text-foreground hover:bg-muted
                       transition-colors disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            {exportando ? 'Exportando…' : 'Exportar'}
          </button>
          <button
            onClick={() => router.push('/clientes/nuevo')}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg
                       bg-primary text-primary-foreground font-medium
                       hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Nuevo cliente
          </button>
        </div>
      </div>

      {/* ── Stats cards rápidas ──────────────────────────────── */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total',     value: stats.total || 0,    color: 'text-foreground' },
            { label: 'Activos',   value: stats.activos || 0,  color: 'text-green-600' },
            { label: 'Morosos',   value: stats.morosos || 0,  color: 'text-orange-600' },
            { label: 'Baja',      value: stats.baja || 0,     color: 'text-muted-foreground' },
          ].map((s) => (
            <div key={s.label}
                 className="bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-3">
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={cn('text-xl font-bold', s.color)}>{s.value.toLocaleString('es-PE')}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Toolbar: búsqueda + tabs estado ─────────────────── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">

        {/* Búsqueda y filtros */}
        <div className="flex items-center gap-3 p-4 border-b border-border">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar por nombre, DNI, teléfono…"
              value={searchInput}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-input
                         bg-background placeholder:text-muted-foreground
                         focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>

          <select
            value={filtros.tipoServicio ?? ''}
            onChange={(e) => updateFiltro('tipoServicio', e.target.value || undefined)}
            className="px-3 py-2 text-sm rounded-lg border border-input bg-background
                       text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">Todos los servicios</option>
            <option value="ftth">FTTH</option>
            <option value="wisp">WISP</option>
            <option value="dedicado">Dedicado</option>
            <option value="mixto">Mixto</option>
          </select>

          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-2 rounded-lg border border-input text-muted-foreground
                       hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            title="Refrescar"
          >
            <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
          </button>
        </div>

        {/* Tabs de estado */}
        <div className="flex border-b border-border px-4 gap-1">
          {ESTADO_TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => updateFiltro('estado', key || undefined)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors',
                (filtros.estado ?? '') === key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
              {key === '' && meta?.total != null && (
                <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full">
                  {meta.total}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tabla */}
        <ClientesTable
          clientes={clientes}
          loading={isLoading}
          onRowClick={(c) => router.push(`/clientes/${c.id}`)}
          sortBy={filtros.orderBy}
          sortOrder={filtros.order}
          onSort={(col, dir) => { updateFiltro('orderBy', col); updateFiltro('order', dir); }}
        />

        {/* Paginación */}
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <p className="text-xs text-muted-foreground">
              Mostrando {((meta.page - 1) * meta.limit) + 1}–
              {Math.min(meta.page * meta.limit, meta.total)} de {meta.total.toLocaleString('es-PE')}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => updateFiltro('page', meta.page - 1)}
                disabled={!meta.hasPrev}
                className="px-3 py-1.5 text-xs rounded-lg border border-input
                           disabled:opacity-40 hover:bg-muted transition-colors"
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
                        : 'border-input hover:bg-muted',
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
                           disabled:opacity-40 hover:bg-muted transition-colors"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
