'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Activity, ChevronLeft, ChevronRight } from 'lucide-react';
import { oltNativoApi } from '@/lib/api/olt-nativo';
import { cn } from '@/lib/utils';

const ESTADO_COLOR: Record<string, string> = {
  success:  'bg-emerald-500/10 text-emerald-400',
  ok:       'bg-emerald-500/10 text-emerald-400',
  error:    'bg-red-500/10 text-red-400',
  timeout:  'bg-yellow-500/10 text-yellow-400',
  degraded: 'bg-orange-500/10 text-orange-400',
};

const PAGE_SIZE = 20;

export function TabEventos({ oltId }: { oltId: string }) {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['olt-eventos', oltId, page],
    queryFn:  () => oltNativoApi.getEventos(oltId, page, PAGE_SIZE),
    enabled:  !!oltId,
    placeholderData: (prev) => prev,
  });

  const total      = data?.total ?? 0;
  const items      = data?.data  ?? [];
  const totalPages = Math.ceil(total / PAGE_SIZE);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Activity className="w-8 h-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">Sin eventos de operación registrados</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Fecha</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Tipo</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Estado</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden md:table-cell">ONU SN</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden lg:table-cell">Latencia</th>
            </tr>
          </thead>
          <tbody>
            {items.map((ev) => (
              <tr key={ev.id} className="border-b border-border last:border-0 hover:bg-muted/10 transition-colors">
                <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground whitespace-nowrap">
                  {new Date(ev.createdAt).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })}
                </td>
                <td className="px-4 py-2.5 text-xs font-medium text-foreground">{ev.tipo}</td>
                <td className="px-4 py-2.5">
                  <span className={cn(
                    'text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase',
                    ESTADO_COLOR[ev.estado] ?? 'bg-muted text-muted-foreground',
                  )}>
                    {ev.estado}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground hidden md:table-cell">
                  {ev.onuSn ?? '—'}
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground hidden lg:table-cell">
                  {ev.latenciaMs != null ? `${ev.latenciaMs}ms` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{total} eventos</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1 rounded hover:bg-muted disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span>Página {page} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1 rounded hover:bg-muted disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
