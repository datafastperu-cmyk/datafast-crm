'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GitMerge, Plus, X, Loader2, AlertCircle, MapPin } from 'lucide-react';

import { plantaExternaApi, type CrearMufaDto } from '@/lib/api/planta-externa';
import { CapturaCoordenadas, type Coordenadas } from './CapturaCoordenadas';
import { MufaDetalleModal } from './MufaDetalleModal';
import { useToast } from '@/components/ui/toaster';
import { Portal } from '@/components/ui/portal';
import { parseApiError, cn } from '@/lib/utils';

const inputCls = 'w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors';
const labelCls = 'text-xs font-medium text-muted-foreground block mb-1';

const ESTADO_COLOR: Record<string, string> = {
  planificado: 'text-sky-500 bg-sky-500/10 border-sky-500/20',
  instalado:   'text-amber-500 bg-amber-500/10 border-amber-500/20',
  operativo:   'text-emerald-500 bg-emerald-500/10 border-emerald-500/20',
  averiado:    'text-destructive bg-destructive/10 border-destructive/20',
  retirado:    'text-muted-foreground bg-muted border-border',
};

function CrearMufaModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [form, setForm]     = useState<Partial<CrearMufaDto>>({ jerarquia: 'primer_nivel' });
  const [coords, setCoords] = useState<Partial<Coordenadas>>({});

  const crear = useMutation({
    mutationFn: () => plantaExternaApi.crearMufa({
      codigo:        form.codigo!.trim(),
      jerarquia:     form.jerarquia,
      latitud:       coords.latitud!,
      longitud:      coords.longitud!,
      precisionGpsM: coords.precisionGpsM,
      direccion:     form.direccion?.trim() || undefined,
      descripcion:   form.descripcion?.trim() || undefined,
    }),
    onSuccess: () => { toast(`Mufa ${form.codigo} creada`, { type: 'success' }); onCreated(); },
    onError:   (err) => toast(parseApiError(err), { type: 'error' }),
  });

  const valido = !!form.codigo?.trim() && coords.latitud != null && coords.longitud != null;

  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
        <div role="dialog" aria-modal="true"
          className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl"
          onClick={(e) => e.stopPropagation()}>

          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
                <GitMerge className="w-4 h-4 text-primary" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">Nueva mufa de empalme</h3>
            </div>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); if (valido) crear.mutate(); }} className="p-5 space-y-3.5">
            <div>
              <label className={labelCls}>Código *</label>
              <input className={inputCls} placeholder="MUFA-07"
                value={form.codigo ?? ''}
                onChange={(e) => setForm({ ...form, codigo: e.target.value })} />
            </div>

            <div>
              <label className={labelCls}>Jerarquía *</label>
              <select className={inputCls} value={form.jerarquia}
                onChange={(e) => setForm({ ...form, jerarquia: e.target.value as CrearMufaDto['jerarquia'] })}>
                <option value="primer_nivel">Primer nivel</option>
                <option value="segundo_nivel">Segundo nivel</option>
              </select>
              {/* Una mufa sin splitter no es un caso raro: la de fusión pura (continuidad)
                  y la de derivación son la mayoría de la planta. El splitter se agrega
                  después, si corresponde. */}
              <p className="text-[11px] text-muted-foreground mt-1">
                Los empalmes, fusiones y splitters se cargan después, al abrir la mufa.
              </p>
            </div>

            <CapturaCoordenadas value={coords} onChange={setCoords} />

            <div>
              <label className={labelCls}>Dirección / referencia</label>
              <input className={inputCls} placeholder="Poste 14, Av. Los Álamos"
                value={form.direccion ?? ''}
                onChange={(e) => setForm({ ...form, direccion: e.target.value })} />
            </div>

            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose}
                className="flex-1 px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted">
                Cancelar
              </button>
              <button type="submit" disabled={!valido || crear.isPending}
                className="flex-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2">
                {crear.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Crear mufa
              </button>
            </div>
          </form>
        </div>
      </div>
    </Portal>
  );
}

export function MufasTab() {
  const qc = useQueryClient();
  const [crear, setCrear] = useState(false);
  const [detalleId, setDetalleId] = useState<string | null>(null);

  const { data: mufas = [], isLoading, isError, error } = useQuery({
    queryKey: ['planta-externa-mufas'],
    queryFn:  () => plantaExternaApi.listarMufas(),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Cajas de empalme: fusiones, derivaciones y splitters
        </p>
        <button onClick={() => setCrear(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
          <Plus className="w-4 h-4" /> Nueva mufa
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      )}

      {isError && (
        <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3">
          <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-xs text-destructive">{parseApiError(error)}</p>
        </div>
      )}

      {!isLoading && !isError && mufas.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <GitMerge className="w-8 h-8 mb-2 opacity-40" />
          <p className="text-sm">Todavía no hay mufas registradas</p>
        </div>
      )}

      {mufas.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {mufas.map((m) => (
            <button key={m.id} onClick={() => setDetalleId(m.id)}
              className="text-left rounded-xl border border-border bg-card p-4 space-y-2 hover:border-primary/40 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{m.codigo}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {m.direccion || 'Sin dirección'}
                  </p>
                </div>
                <span className={cn('shrink-0 text-[10px] font-medium px-2 py-1 rounded-md border capitalize',
                  ESTADO_COLOR[m.estado] ?? ESTADO_COLOR.planificado)}>
                  {m.estado}
                </span>
              </div>

              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <span>{m.jerarquia === 'primer_nivel' ? '1er nivel' : '2do nivel'}</span>
                <span className="opacity-40">·</span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {Number(m.latitud).toFixed(5)}, {Number(m.longitud).toFixed(5)}
                </span>
              </div>

              <p className="text-[11px] text-primary">Ver empalmes y splitters →</p>
            </button>
          ))}
        </div>
      )}

      {crear && (
        <CrearMufaModal
          onClose={() => setCrear(false)}
          onCreated={() => { setCrear(false); qc.invalidateQueries({ queryKey: ['planta-externa-mufas'] }); }}
        />
      )}

      {detalleId && (
        <MufaDetalleModal mufaId={detalleId} onClose={() => setDetalleId(null)} />
      )}
    </div>
  );
}
