'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Hash, Loader2, Save, Trash2, Info } from 'lucide-react';
import { oltNativoApi } from '@/lib/api/olt-nativo';
import { useToast } from '@/components/ui/toaster';

// Sección de configuración del pool de Service Port IDs de la OLT.
// El ERP asigna el índice a cada ONU aprovisionada desde este rango y lleva el control.
export function ServicePortPoolSection({ oltId }: { oltId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [inicio, setInicio] = useState('');
  const [fin,    setFin]    = useState('');
  const [err,    setErr]    = useState('');

  const { data: estado, isLoading } = useQuery({
    queryKey: ['service-port-pool', oltId],
    queryFn:  () => oltNativoApi.servicePortPoolEstado(oltId),
    enabled:  !!oltId,
  });

  const configMut = useMutation({
    mutationFn: (dto: { inicio: number; fin: number }) => oltNativoApi.configurarServicePortPool(oltId, dto),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['service-port-pool', oltId] });
      setInicio(''); setFin(''); setErr('');
      toast(`Pool configurado: ${r.creados} IDs agregados`, { type: 'success' });
    },
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Error al configurar el pool'), // eslint-disable-line
  });

  const limpiarMut = useMutation({
    mutationFn: () => oltNativoApi.limpiarServicePortPoolLibres(oltId),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['service-port-pool', oltId] });
      toast(`${r.eliminados} IDs libres eliminados`, { type: 'success' });
    },
    onError: () => toast('Error al limpiar el pool', { type: 'error' }),
  });

  const submit = () => {
    const i = parseInt(inicio, 10);
    const f = parseInt(fin, 10);
    if (isNaN(i) || i < 1)      { setErr('Inicio inválido (mín 1)'); return; }
    if (isNaN(f) || f < i)      { setErr('Fin debe ser ≥ inicio'); return; }
    if (f - i >= 4096)          { setErr('El rango no puede superar 4096 IDs'); return; }
    setErr('');
    configMut.mutate({ inicio: i, fin: f });
  };

  const configurado = !!estado?.rango;

  return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Hash className="w-4 h-4 text-primary" />
        <h4 className="text-sm font-semibold text-foreground">Pool de Service Port IDs</h4>
      </div>

      <p className="text-xs text-muted-foreground flex items-start gap-1.5">
        <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        El ERP asigna automáticamente un Service Port ID de este rango a cada ONU aprovisionada y lleva el control.
        Elige un rango amplio (ej. 1500–4000); si algún ID ya existe en la OLT, el ERP lo detecta y reasigna el
        siguiente automáticamente durante la provisión.
      </p>

      {isLoading ? (
        <div className="h-16 rounded-lg bg-muted/40 animate-pulse" />
      ) : configurado ? (
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Rango',    value: `${estado!.rango!.min}–${estado!.rango!.max}` },
            { label: 'Total',    value: estado!.total },
            { label: 'Libres',   value: estado!.libres,   cls: 'text-green-600' },
            { label: 'Ocupados', value: estado!.ocupados, cls: 'text-amber-600' },
          ].map(s => (
            <div key={s.label} className="rounded-lg bg-muted/30 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
              <p className={`text-sm font-semibold ${s.cls ?? 'text-foreground'}`}>{s.value}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-amber-600 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
          Sin pool configurado — hoy debes ingresar el Service Port ID manualmente al aprovisionar. Configura un rango abajo para automatizarlo.
        </div>
      )}

      {/* Configurar / ampliar rango */}
      <div className="flex gap-2 flex-wrap items-end pt-1">
        <div>
          <label className="block text-[11px] text-muted-foreground mb-1">Inicio</label>
          <input value={inicio} onChange={e => { setInicio(e.target.value); setErr(''); }} placeholder="1500"
            className="w-28 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <div>
          <label className="block text-[11px] text-muted-foreground mb-1">Fin</label>
          <input value={fin} onChange={e => { setFin(e.target.value); setErr(''); }} placeholder="4000"
            className="w-28 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <button onClick={submit} disabled={configMut.isPending}
          className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60">
          {configMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {configurado ? 'Ampliar rango' : 'Configurar pool'}
        </button>
        {configurado && estado!.libres > 0 && (
          <button onClick={() => limpiarMut.mutate()} disabled={limpiarMut.isPending}
            title="Elimina los IDs libres para reconfigurar el rango (no toca los ocupados)"
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors text-muted-foreground disabled:opacity-60">
            <Trash2 className="w-3.5 h-3.5" /> Limpiar libres
          </button>
        )}
      </div>
      {err && <p className="text-xs text-red-500">{err}</p>}
    </div>
  );
}
