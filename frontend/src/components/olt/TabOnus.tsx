'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Users, ChevronLeft, ChevronRight } from 'lucide-react';
import { oltNativoApi } from '@/lib/api/olt-nativo';
import { cn } from '@/lib/utils';

const ESTADO_COLOR: Record<string, string> = {
  activo:      'bg-emerald-500/10 text-emerald-400',
  suspendido:  'bg-yellow-500/10 text-yellow-400',
  pendiente:   'bg-blue-500/10 text-blue-400',
  error:       'bg-red-500/10 text-red-400',
};

const PAGE_SIZE = 50;

const fmtUptime = (secs: number | null) => {
  if (!secs) return null;
  const d = Math.floor(secs / 86_400);
  const h = Math.floor((secs % 86_400) / 3_600);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
};

export function TabOnus({ oltId }: { oltId: string }) {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['olt-ftth-registros', oltId, page],
    queryFn:  () => oltNativoApi.getFtthRegistros(oltId, page, PAGE_SIZE),
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
        <Users className="w-8 h-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">Sin ONUs aprovisionadas en esta OLT</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">SN</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Slot/Port</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden sm:table-cell">ONU ID</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden md:table-cell">VLAN</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Estado</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden xl:table-cell">Run State</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden xl:table-cell">Uptime</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden lg:table-cell">Contrato ID</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/10 transition-colors">
                <td className="px-4 py-2.5 font-mono text-xs text-foreground">{r.sn}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">
                  {r.slot}/{r.port}
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground hidden sm:table-cell">{r.onuId}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground hidden md:table-cell">{r.vlan}</td>
                <td className="px-4 py-2.5">
                  <span className={cn(
                    'text-[10px] font-semibold px-1.5 py-0.5 rounded capitalize',
                    ESTADO_COLOR[r.estado] ?? 'bg-muted text-muted-foreground',
                  )}>
                    {r.estado}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground hidden xl:table-cell">
                  {r.runState ?? '—'}
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground hidden xl:table-cell">
                  {fmtUptime(r.uptimeSeconds) ?? '—'}
                </td>
                <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground hidden lg:table-cell">
                  {r.contratoId ? `…${r.contratoId.slice(-8)}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{total} ONUs</span>
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
