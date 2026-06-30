'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Trash2, Loader2 } from 'lucide-react';
import { oltNativoApi } from '@/lib/api/olt-nativo';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';

interface Props {
  oltId:    string;
  oltNombre: string;
  onDeleted: () => void;
}

export function PeligrosoTab({ oltId, oltNombre, onDeleted }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [confirmText, setConfirmText] = useState('');

  const delMut = useMutation({
    mutationFn: () => oltNativoApi.eliminar(oltId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['olt-nativas'] });
      qc.invalidateQueries({ queryKey: ['olts-config'] });
      toast(`OLT "${oltNombre}" eliminada`, { type: 'success' });
      onDeleted();
    },
    onError: (e: any) => {
      toast(e?.response?.data?.message ?? 'Error al eliminar la OLT', { type: 'error' });
    },
  });

  const confirmed = confirmText.trim() === oltNombre.trim();

  return (
    <div className="space-y-6">

      {/* Eliminar OLT */}
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-red-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
            <AlertTriangle className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h4 className="font-semibold text-foreground">Eliminar OLT</h4>
            <p className="text-sm text-muted-foreground mt-1">
              Esto desvincula la OLT del sistema (soft delete). Los registros de ONUs y contratos asociados
              quedan huérfanos hasta que los reasignes a otra OLT.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">
              Escribe <span className="font-mono font-semibold text-foreground">{oltNombre}</span> para confirmar:
            </p>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={oltNombre}
              className={cn(
                'w-full px-3 py-2 text-sm rounded-lg border bg-background text-foreground outline-none transition-colors',
                'focus:ring-2 focus:border-red-500',
                confirmed
                  ? 'border-red-500 focus:ring-red-500/30'
                  : 'border-border focus:ring-red-500/20',
              )}
            />
          </div>

          {delMut.isError && (
            <p className="text-xs text-red-500">
              {(delMut.error as any)?.response?.data?.message ?? 'Error al eliminar'}
            </p>
          )}

          <button
            onClick={() => delMut.mutate()}
            disabled={!confirmed || delMut.isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-red-500 text-white
                       hover:bg-red-600 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {delMut.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Eliminando…</>
              : <><Trash2 className="w-4 h-4" /> Eliminar OLT</>}
          </button>
        </div>
      </div>

    </div>
  );
}
