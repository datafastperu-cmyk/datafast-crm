'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { promesasApi } from '@/lib/api/promesas';
import type { PromesaRow, PromesaStats } from '@/lib/api/promesas';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import {
  RefreshCw, Clock, Ban, CheckCircle, Loader2, AlertCircle,
  ChevronLeft, ChevronRight, CalendarDays, Wifi, WifiOff,
} from 'lucide-react';

const fmt = (n: number | string | null | undefined) => (+(n ?? 0)).toFixed(2);

/* ══════════════════════════════════════════════════════════════════ */
/*  Tab: Promesas de Pago                                             */
/* ══════════════════════════════════════════════════════════════════ */

const PROMESA_ESTADO_BADGE: Record<string, string> = {
  activa:            'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  vencida_pendiente: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  vencida:           'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  cumplida:          'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  cancelada:         'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
};
const PROMESA_ESTADO_LABEL: Record<string, string> = {
  activa: 'ACTIVA', vencida_pendiente: 'PEND.CORTE',
  vencida: 'VENCIDA', cumplida: 'CUMPLIDA', cancelada: 'CANCELADA',
};

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={cn('rounded-lg border p-4 flex flex-col gap-1', color)}>
      <span className="text-2xl font-bold">{value}</span>
      <span className="text-xs font-medium opacity-70">{label}</span>
    </div>
  );
}

export function TabPromesas() {
  const qc                                   = useQueryClient();
  const { toast }                            = useToast();
  const [filtroEstado, setFiltroEstado]      = useState('');
  const [page, setPage]                      = useState(1);
  const [confirmCancel, setConfirmCancel]    = useState<string | null>(null);

  const { data: statsData, isLoading: statsLoading } = useQuery<PromesaStats>({
    queryKey: ['promesas-stats'],
    queryFn:  () => promesasApi.stats(),
    refetchInterval: 30_000,
  });

  const { data: listData, isLoading: listLoading, refetch } = useQuery({
    queryKey: ['promesas-lista', filtroEstado, page],
    queryFn:  () => promesasApi.listar({ estado: filtroEstado || undefined, page, limit: 20 }),
    refetchInterval: 30_000,
  });

  const cancelarMut = useMutation({
    mutationFn: (id: string) => promesasApi.cancelar(id),
    onSuccess: () => {
      toast('Promesa cancelada', { type: 'success' });
      setConfirmCancel(null);
      void qc.invalidateQueries({ queryKey: ['promesas-lista'] });
      void qc.invalidateQueries({ queryKey: ['promesas-stats'] });
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      toast(err?.response?.data?.message ?? 'Error al cancelar', { type: 'error' });
      setConfirmCancel(null);
    },
  });

  const promesas: PromesaRow[] = listData?.data ?? [];
  const meta                   = listData?.meta;
  const stats: PromesaStats    = statsData ?? { activas: 0, vencenHoy: 0, vencidas: 0, cumplidas: 0 };

  const fmtFecha = (iso: string) => {
    const [y, m, d] = iso.split('T')[0].split('-');
    return `${d}/${m}/${y}`;
  };

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4">

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {statsLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-lg border p-4 h-20 animate-pulse bg-gray-100 dark:bg-gray-800" />
            ))
          : <>
              <StatCard label="Activas"    value={stats.activas}   color="border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300" />
              <StatCard label="Vencen hoy" value={stats.vencenHoy} color="border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300" />
              <StatCard label="Vencidas"   value={stats.vencidas}  color="border-red-200 dark:border-red-800 text-red-700 dark:text-red-300" />
              <StatCard label="Cumplidas"  value={stats.cumplidas} color="border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300" />
            </>
        }
      </div>

      {/* Filters + refresh */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filtroEstado}
          onChange={e => { setFiltroEstado(e.target.value); setPage(1); }}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded
                     bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">Todos los estados</option>
          <option value="activa">Activa</option>
          <option value="vencida_pendiente">Pendiente corte</option>
          <option value="vencida">Vencida</option>
          <option value="cumplida">Cumplida</option>
          <option value="cancelada">Cancelada</option>
        </select>
        <button
          onClick={() => void refetch()}
          className="p-1.5 rounded border border-gray-300 dark:border-gray-600 text-gray-500 hover:text-gray-700
                     dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          title="Actualizar"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
        {meta && (
          <span className="text-xs text-gray-400 ml-auto">{meta.total} promesa{meta.total !== 1 ? 's' : ''}</span>
        )}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Cliente / Contrato</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">IP / Router</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Vencimiento</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Deuda</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Estado</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">MikroTik</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {listLoading && (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              )}
              {!listLoading && promesas.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-gray-400">
                    <CalendarDays className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No hay promesas de pago registradas
                  </td>
                </tr>
              )}
              {promesas.map(p => (
                <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  {/* Cliente / Contrato */}
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900 dark:text-gray-100 truncate max-w-[180px]">{p.clienteNombre}</p>
                    <p className="text-xs text-gray-400">{p.numeroContrato}</p>
                  </td>
                  {/* IP / Router */}
                  <td className="px-4 py-3">
                    <p className="font-mono text-xs text-gray-700 dark:text-gray-300">{p.ipAsignada ?? '—'}</p>
                    <p className="text-xs text-gray-400 truncate max-w-[120px]">{p.routerNombre ?? '—'}</p>
                  </td>
                  {/* Vencimiento */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      <span className={cn(
                        'text-sm',
                        p.estado === 'activa' && p.fechaVencimiento <= new Date().toISOString().split('T')[0]
                          ? 'text-red-600 dark:text-red-400 font-semibold'
                          : 'text-gray-700 dark:text-gray-300',
                      )}>
                        {fmtFecha(p.fechaVencimiento)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">Creada {fmtFecha(p.creadaEn)}</p>
                  </td>
                  {/* Deuda */}
                  <td className="px-4 py-3 text-right">
                    <span className="font-semibold text-gray-900 dark:text-gray-100">
                      S/ {fmt(p.deudaAlCrear)}
                    </span>
                  </td>
                  {/* Estado */}
                  <td className="px-4 py-3 text-center">
                    <span className={cn(
                      'inline-flex px-2 py-0.5 rounded-full text-xs font-semibold',
                      PROMESA_ESTADO_BADGE[p.estado] ?? 'bg-gray-100 text-gray-500',
                    )}>
                      {PROMESA_ESTADO_LABEL[p.estado] ?? p.estado.toUpperCase()}
                    </span>
                  </td>
                  {/* MikroTik */}
                  <td className="px-4 py-3 text-center">
                    {p.mikrotikAplicado ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                        <Wifi className="w-3.5 h-3.5" /> OK
                      </span>
                    ) : p.mikrotikReintentos >= 5 ? (
                      <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400 font-medium">
                        <WifiOff className="w-3.5 h-3.5" /> Fallido
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Pendiente
                      </span>
                    )}
                  </td>
                  {/* Acciones */}
                  <td className="px-4 py-3 text-center">
                    {p.estado === 'activa' && (
                      confirmCancel === p.id ? (
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => cancelarMut.mutate(p.id)}
                            disabled={cancelarMut.isPending}
                            className="px-2 py-1 text-xs font-medium bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 transition-colors"
                          >
                            {cancelarMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : '¿Confirmar?'}
                          </button>
                          <button
                            onClick={() => setConfirmCancel(null)}
                            className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmCancel(p.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-600
                                     dark:text-red-400 border border-red-200 dark:border-red-800 rounded
                                     hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        >
                          <Ban className="w-3 h-3" /> Cancelar
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Página {meta.page} de {meta.totalPages}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1 rounded text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage(p => Math.min(meta.totalPages, p + 1))}
                disabled={page >= meta.totalPages}
                className="p-1 rounded text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-30"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
