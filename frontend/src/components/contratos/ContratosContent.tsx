'use client';

import { useState, useCallback } from 'react';
import { useRouter }             from 'next/navigation';
import { useQuery }              from '@tanstack/react-query';
import {
  Search, Plus, RefreshCw, FileText,
  AlertTriangle, Wifi, WifiOff, Clock,
} from 'lucide-react';

import { contratosApi, type FiltrosContrato } from '@/lib/api/contratos';
import { ContratosTable }    from './ContratosTable';
import { useDebounce }       from '@/hooks/useDebounce';
import { cn, formatPEN }     from '@/lib/utils';

const ESTADO_TABS = [
  { key: '',                    label: 'Todos',         icon: FileText },
  { key: 'activo',              label: 'Activos',       icon: Wifi },
  { key: 'suspendido_mora',     label: 'Suspendidos',   icon: WifiOff },
  { key: 'prorroga',            label: 'Prórroga',      icon: Clock },
  { key: 'pendiente_instalacion', label: 'Pendientes',  icon: AlertTriangle },
];

export function ContratosContent() {
  const router = useRouter();
  const [filtros, setFiltros]    = useState<FiltrosContrato>({ page: 1, limit: 25 });
  const [searchInput, setSearch] = useState('');
  const searchDebounced          = useDebounce(searchInput, 400);

  const upd = useCallback(<K extends keyof FiltrosContrato>(k: K, v: FiltrosContrato[K]) =>
    setFiltros((f) => ({ ...f, [k]: v, page: 1 })), []);

  const params: FiltrosContrato = {
    ...filtros,
    search: searchDebounced || undefined,
  };

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey:  ['contratos', params],
    queryFn:   () => contratosApi.list(params),
    placeholderData: (prevData) => prevData,
  });

  const { data: stats } = useQuery({
    queryKey: ['contratos-stats'],
    queryFn:  contratosApi.getStats,
    staleTime: 60_000,
  });

  const contratos = data?.data ?? [];
  const meta      = data?.meta;

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Contratos</h2>
          <p className="text-sm text-muted-foreground">
            {meta?.total != null
              ? `${meta.total.toLocaleString('es-PE')} contratos registrados`
              : 'Gestión de contratos de servicio'}
          </p>
        </div>
        <button
          onClick={() => router.push('/contratos/nuevo')}
          className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg
                     bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Nuevo contrato
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Total',       value: stats.total ?? 0,          color: 'text-foreground' },
            { label: 'Activos',     value: stats.activos ?? 0,        color: 'text-green-600' },
            { label: 'Suspendidos', value: stats.suspendidos ?? 0,    color: 'text-red-600' },
            { label: 'Prórroga',    value: stats.prorroga ?? 0,       color: 'text-blue-600' },
            { label: 'Cuentas ×cobrar',
                                    value: formatPEN(stats.cuentasPorCobrar ?? 0),
                                                                       color: 'text-orange-600' },
          ].map((s) => (
            <div key={s.label}
                 className="bg-card border border-border rounded-xl px-4 py-3">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={cn('text-xl font-bold mt-0.5', s.color)}>
                {typeof s.value === 'number' ? s.value.toLocaleString('es-PE') : s.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Tabla con toolbar */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">

        {/* Toolbar */}
        <div className="flex items-center gap-3 p-4 border-b border-border">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar por N° contrato, cliente, IP…"
              value={searchInput}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-input
                         bg-background placeholder:text-muted-foreground
                         focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Filtro "con deuda" */}
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={filtros.conDeuda ?? false}
              onChange={(e) => upd('conDeuda', e.target.checked || undefined)}
              className="rounded"
            />
            Con deuda
          </label>

          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-2 rounded-lg border border-input text-muted-foreground
                       hover:text-foreground hover:bg-muted transition-colors"
          >
            <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
          </button>
        </div>

        {/* Tabs de estado */}
        <div className="flex border-b border-border px-4 gap-1">
          {ESTADO_TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => upd('estado', key || undefined)}
              className={cn(
                'px-3 py-2.5 text-xs font-medium border-b-2 transition-colors',
                (filtros.estado ?? '') === key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tabla */}
        <ContratosTable
          contratos={contratos}
          loading={isLoading}
          onRowClick={(c) => router.push(`/contratos/${c.id}`)}
        />

        {/* Paginación */}
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <p className="text-xs text-muted-foreground">
              {((meta.page - 1) * meta.limit) + 1}–
              {Math.min(meta.page * meta.limit, meta.total)} de {meta.total.toLocaleString('es-PE')}
            </p>
            <div className="flex items-center gap-1">
              <PagBtn disabled={!meta.hasPrev} onClick={() => upd('page', meta.page - 1)}>
                ← Anterior
              </PagBtn>
              {Array.from({ length: Math.min(meta.totalPages, 5) }, (_, i) => i + 1).map((p) => (
                <PagBtn key={p} active={meta.page === p} onClick={() => upd('page', p)}>
                  {p}
                </PagBtn>
              ))}
              <PagBtn disabled={!meta.hasNext} onClick={() => upd('page', meta.page + 1)}>
                Siguiente →
              </PagBtn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PagBtn({
  children, onClick, disabled, active,
}: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'px-3 py-1.5 text-xs rounded-lg border transition-colors',
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'border-input hover:bg-muted disabled:opacity-40',
      )}
    >
      {children}
    </button>
  );
}
