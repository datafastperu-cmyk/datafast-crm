'use client';
import { useState, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { redOnusApi, OnuRow }           from '@/lib/api/red-onus';
import { MoreVertical, RefreshCw, WifiOff, Wifi, RotateCcw, Info } from 'lucide-react';

interface Props {
  row: OnuRow;
  onSenalUpdate: (sn: string, rx: number | null, tx: number | null, temp: number | null) => void;
}

export function OnuAccionMenu({ row, onSenalUpdate }: Props) {
  const [open, setOpen]         = useState(false);
  const [confirm, setConfirm]   = useState<'suspender' | 'rehabilitar' | 'resetear' | null>(null);
  const [versionInfo, setVersion] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const qc  = useQueryClient();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const senalMut = useMutation({
    mutationFn: () => redOnusApi.refreshSenal(row.sn),
    onSuccess: (d) => {
      onSenalUpdate(row.sn, d.rxPower, d.txPower, d.temperatura);
      setOpen(false);
    },
  });

  const actionMut = useMutation({
    mutationFn: async (action: 'suspender' | 'rehabilitar' | 'resetear') => {
      if (action === 'suspender')   await redOnusApi.suspender(row.sn);
      if (action === 'rehabilitar') await redOnusApi.rehabilitar(row.sn);
      if (action === 'resetear')    await redOnusApi.resetear(row.sn);
    },
    onSuccess: () => {
      setConfirm(null);
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['red-onus'] });
    },
  });

  const versionMut = useMutation({
    mutationFn: () => redOnusApi.getVersion(row.sn),
    onSuccess: (d) => {
      setVersion(d.exitoso
        ? `SW: ${d.softwareVersion ?? '—'} | HW: ${d.ontVersion ?? '—'} | ID: ${d.equipmentId ?? '—'}`
        : `Error: ${d.error ?? 'desconocido'}`);
    },
  });

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"
      >
        <MoreVertical size={14} />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-52 bg-white border border-gray-200 rounded-lg shadow-lg py-1">
          <MenuItem
            icon={<RefreshCw size={12} />}
            label={senalMut.isPending ? 'Consultando...' : 'Actualizar señal'}
            onClick={() => senalMut.mutate()}
            disabled={senalMut.isPending}
          />
          <MenuItem
            icon={<WifiOff size={12} />}
            label="Suspender ONU"
            onClick={() => setConfirm('suspender')}
            danger
          />
          <MenuItem
            icon={<Wifi size={12} />}
            label="Rehabilitar ONU"
            onClick={() => setConfirm('rehabilitar')}
          />
          <MenuItem
            icon={<RotateCcw size={12} />}
            label="Resetear ONU"
            onClick={() => setConfirm('resetear')}
            danger
          />
          <MenuItem
            icon={<Info size={12} />}
            label={versionMut.isPending ? 'Consultando...' : 'Ver versión firmware'}
            onClick={() => versionMut.mutate()}
            disabled={versionMut.isPending}
          />

          {versionInfo && (
            <div className="px-3 py-2 text-xs text-gray-600 border-t border-gray-100 bg-gray-50 break-all">
              {versionInfo}
            </div>
          )}

          {confirm && (
            <div className="px-3 py-2 border-t border-gray-100">
              <p className="text-xs text-gray-700 mb-2">
                ¿Confirmar <strong>{confirm}</strong> {row.sn}?
              </p>
              <div className="flex gap-2">
                <button
                  className="flex-1 text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                  disabled={actionMut.isPending}
                  onClick={() => actionMut.mutate(confirm)}
                >
                  {actionMut.isPending ? '...' : 'Confirmar'}
                </button>
                <button
                  className="flex-1 text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-50"
                  onClick={() => setConfirm(null)}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger, disabled }: {
  icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; disabled?: boolean;
}) {
  return (
    <button
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-40
        ${danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700'}`}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
      {label}
    </button>
  );
}
