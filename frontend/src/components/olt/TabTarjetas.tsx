'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2, Layers } from 'lucide-react';
import { oltNativoApi } from '@/lib/api/olt-nativo';
import { cn } from '@/lib/utils';

const ESTADO_COLOR: Record<string, string> = {
  normal:  'bg-emerald-500/10 text-emerald-400',
  online:  'bg-emerald-500/10 text-emerald-400',
  offline: 'bg-red-500/10 text-red-400',
  unknown: 'bg-muted text-muted-foreground',
  fault:   'bg-red-600/20 text-red-500',
};

export function TabTarjetas({ oltId }: { oltId: string }) {
  const { data: boards = [], isLoading } = useQuery({
    queryKey: ['olt-boards', oltId],
    queryFn:  () => oltNativoApi.getBoards(oltId),
    enabled:  !!oltId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (boards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Layers className="w-8 h-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">Sin tarjetas sincronizadas — usa &quot;Sincronizar&quot; para cargar</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {boards.map((board) => (
        <div key={board.id} className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase">Slot {board.slot}</p>
              <p className="text-sm font-semibold text-foreground mt-0.5">{board.boardType}</p>
            </div>
            <span className={cn(
              'text-[10px] font-semibold px-2 py-0.5 rounded capitalize',
              ESTADO_COLOR[board.estado] ?? 'bg-muted text-muted-foreground',
            )}>
              {board.estado}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">ONUs activas</span>
            <span className="font-semibold text-foreground">{board.onuCount}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
