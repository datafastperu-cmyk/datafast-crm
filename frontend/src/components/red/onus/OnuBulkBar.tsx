'use client';
import { useState }   from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { redOnusApi }  from '@/lib/api/red-onus';
import { RefreshCw, WifiOff, Wifi, X } from 'lucide-react';

interface Props {
  selected:   Set<string>;
  onClearAll: () => void;
}

export function OnuBulkBar({ selected, onClearAll }: Props) {
  const [confirm, setConfirm] = useState<'suspender' | 'rehabilitar' | null>(null);
  const qc = useQueryClient();

  const batchMut = useMutation({
    mutationFn: () => redOnusApi.iniciarBatch([...selected]),
    onSuccess: () => { /* WS events update rows in real-time */ },
  });

  const bulkActionMut = useMutation({
    mutationFn: async (action: 'suspender' | 'rehabilitar') => {
      await Promise.allSettled([...selected].map(sn =>
        action === 'suspender' ? redOnusApi.suspender(sn) : redOnusApi.rehabilitar(sn)
      ));
    },
    onSuccess: () => {
      setConfirm(null);
      onClearAll();
      qc.invalidateQueries({ queryKey: ['red-onus'] });
    },
  });

  if (selected.size === 0) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-blue-50 border-b border-blue-200">
      <span className="text-sm font-medium text-blue-800">
        {selected.size} ONU{selected.size > 1 ? 's' : ''} seleccionada{selected.size > 1 ? 's' : ''}
      </span>

      <button
        onClick={() => batchMut.mutate()}
        disabled={batchMut.isPending}
        className="flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        <RefreshCw size={12} className={batchMut.isPending ? 'animate-spin' : ''} />
        {batchMut.isPending ? 'Iniciando...' : 'Actualizar señal'}
      </button>

      {batchMut.isSuccess && (
        <span className="text-xs text-blue-700">
          Job iniciado — actualizaciones en tiempo real via WebSocket
        </span>
      )}

      {confirm ? (
        <div className="flex items-center gap-2 ml-2">
          <span className="text-xs text-red-700">¿Confirmar {confirm} {selected.size} ONUs?</span>
          <button
            className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            disabled={bulkActionMut.isPending}
            onClick={() => bulkActionMut.mutate(confirm)}
          >
            {bulkActionMut.isPending ? '...' : 'Sí, confirmar'}
          </button>
          <button className="text-xs px-2 py-1 rounded border border-gray-300" onClick={() => setConfirm(null)}>
            Cancelar
          </button>
        </div>
      ) : (
        <>
          <button
            onClick={() => setConfirm('suspender')}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded border border-orange-300 text-orange-700 hover:bg-orange-50"
          >
            <WifiOff size={12} /> Suspender
          </button>
          <button
            onClick={() => setConfirm('rehabilitar')}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded border border-green-300 text-green-700 hover:bg-green-50"
          >
            <Wifi size={12} /> Rehabilitar
          </button>
        </>
      )}

      <button
        onClick={onClearAll}
        className="ml-auto flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
      >
        <X size={12} /> Deseleccionar
      </button>
    </div>
  );
}
