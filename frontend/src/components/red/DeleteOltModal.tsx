'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Trash2, Loader2, X } from 'lucide-react';
import { oltNativoApi } from '@/lib/api/olt-nativo';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';

interface Props {
  open:      boolean;
  onClose:   () => void;
  oltId:     string;
  oltNombre: string;
  onDeleted: () => void;
}

export function DeleteOltModal({ open, onClose, oltId, oltNombre, onDeleted }: Props) {
  const qc           = useQueryClient();
  const { toast }    = useToast();
  const [confirm, setConfirm] = useState('');

  const delMut = useMutation({
    mutationFn: () => oltNativoApi.eliminar(oltId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['olt-nativas'] });
      qc.invalidateQueries({ queryKey: ['olts-config'] });
      toast(`OLT "${oltNombre}" eliminada`, { type: 'success' });
      setConfirm('');
      onDeleted();
    },
    onError: (e: any) =>
      toast(e?.response?.data?.message ?? 'Error al eliminar la OLT', { type: 'error' }),
  });

  if (!open) return null;

  const confirmed = confirm.trim() === oltNombre.trim();

  const handleClose = () => {
    if (delMut.isPending) return;
    setConfirm('');
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-md mx-4
                      animate-in zoom-in-95 duration-150 border border-red-500/20">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-red-500/15 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-red-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Eliminar OLT</h3>
              <p className="text-xs text-muted-foreground">{oltNombre}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={delMut.isPending}
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-4">
          <p className="text-sm text-muted-foreground">
            Esto desvincula la OLT del sistema (soft delete). Los registros de ONUs y contratos
            asociados quedan huérfanos hasta que los reasignes a otra OLT.
          </p>

          <div>
            <p className="text-xs text-muted-foreground mb-1.5">
              Escribe <span className="font-mono font-semibold text-foreground">{oltNombre}</span> para confirmar:
            </p>
            <input
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder={oltNombre}
              autoFocus
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
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-4 border-t border-border">
          <button
            onClick={handleClose}
            disabled={delMut.isPending}
            className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-accent transition-colors text-foreground"
          >
            Cancelar
          </button>
          <button
            onClick={() => delMut.mutate()}
            disabled={!confirmed || delMut.isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-red-500 text-white
                       hover:bg-red-600 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {delMut.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" />Eliminando…</>
              : <><Trash2  className="w-4 h-4" />Eliminar OLT</>}
          </button>
        </div>
      </div>
    </div>
  );
}
