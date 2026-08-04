'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Box, Plus, X, Loader2, Split, AlertCircle } from 'lucide-react';

import {
  plantaExternaApi,
  type Nap,
  type CrearNapDto,
  type SplitterRelacion,
} from '@/lib/api/planta-externa';
import { CapturaCoordenadas, type Coordenadas } from './CapturaCoordenadas';
import { BotonComoLlegar } from './BotonComoLlegar';
import { useToast } from '@/components/ui/toaster';
import { Portal } from '@/components/ui/portal';
import { parseApiError, cn } from '@/lib/utils';

const inputCls = 'w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors';
const labelCls = 'text-xs font-medium text-muted-foreground block mb-1';

const CAPACIDADES = [8, 16, 24, 32];
const RELACIONES: SplitterRelacion[] = ['1x2', '1x4', '1x8', '1x16', '1x32'];

/**
 * Semáforo de ocupación.
 *
 * Tres estados y no dos, porque "sin puertos libres" tiene dos causas distintas que
 * exigen acciones distintas: una caja saturada necesita obra civil nueva; una caja sin
 * splitter sólo necesita un splitter. Pintarlas del mismo color rojo es lo que hace que
 * el planificador no sepa dónde invertir.
 */
function semaforo(nap: Nap): { color: string; texto: string } {
  if (nap.puertosLibres > 0) {
    return { color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20', texto: `${nap.puertosLibres} libres` };
  }
  if (nap.puertosNoHabilitados > 0) {
    return { color: 'text-amber-500 bg-amber-500/10 border-amber-500/20', texto: `${nap.puertosNoHabilitados} sin splitter` };
  }
  return { color: 'text-destructive bg-destructive/10 border-destructive/20', texto: 'Saturada' };
}

// ─── Modal: crear caja NAP ──────────────────────────────────────

function CrearNapModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState<Partial<CrearNapDto>>({ codigo: '', capacidadPuertos: 16 });
  const [coords, setCoords] = useState<Partial<Coordenadas>>({});

  const crear = useMutation({
    mutationFn: () => plantaExternaApi.crearNap({
      codigo: form.codigo!.trim(),
      capacidadPuertos: form.capacidadPuertos!,
      latitud: coords.latitud!,
      longitud: coords.longitud!,
      precisionGpsM: coords.precisionGpsM,
      direccion: form.direccion?.trim() || undefined,
      descripcion: form.descripcion?.trim() || undefined,
    }),
    onSuccess: (r) => {
      toast(r.mensaje, { type: r.exitoso ? 'success' : 'error' });
      if (r.exitoso) onCreated();
    },
    onError: (err) => toast(parseApiError(err), { type: 'error' }),
  });

  const valido =
    !!form.codigo?.trim() &&
    coords.latitud != null && coords.longitud != null &&
    !!form.capacidadPuertos;

  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
        <div
          role="dialog" aria-modal="true"
          className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
                <Box className="w-4 h-4 text-primary" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">Nueva caja NAP</h3>
            </div>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); if (valido) crear.mutate(); }}
            className="p-5 space-y-3.5"
          >
            <div>
              <label className={labelCls}>Código *</label>
              <input
                className={inputCls}
                placeholder="NAP-042"
                value={form.codigo ?? ''}
                onChange={(e) => setForm({ ...form, codigo: e.target.value })}
              />
            </div>

            <div>
              <label className={labelCls}>Puertos físicos de la caja *</label>
              <select
                className={inputCls}
                value={form.capacidadPuertos}
                onChange={(e) => setForm({ ...form, capacidadPuertos: Number(e.target.value) })}
              >
                {CAPACIDADES.map((c) => <option key={c} value={c}>{c} puertos</option>)}
              </select>
              {/* La confusión que este texto evita es la del diseño original, que trataba
                  capacidad de caja y capacidad de splitter como el mismo número. */}
              <p className="text-[11px] text-muted-foreground mt-1">
                Adaptadores que trae la caja. No es el splitter — ése se instala después y
                habilita sus puertos.
              </p>
            </div>

            <CapturaCoordenadas value={coords} onChange={setCoords} />

            <div>
              <label className={labelCls}>Dirección</label>
              <input
                className={inputCls}
                placeholder="Av. Los Álamos 340, poste 12"
                value={form.direccion ?? ''}
                onChange={(e) => setForm({ ...form, direccion: e.target.value })}
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose}
                className="flex-1 px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted">
                Cancelar
              </button>
              <button type="submit" disabled={!valido || crear.isPending}
                className="flex-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2">
                {crear.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Crear caja
              </button>
            </div>
          </form>
        </div>
      </div>
    </Portal>
  );
}

// ─── Modal: instalar splitter ───────────────────────────────────

function InstalarSplitterModal({ nap, onClose, onDone }: { nap: Nap; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [relacion, setRelacion] = useState<SplitterRelacion>('1x8');

  const instalar = useMutation({
    mutationFn: () => plantaExternaApi.instalarSplitter(nap.id, { relacion }),
    onSuccess: (r) => {
      toast(r.mensaje || r.error || '', { type: r.exitoso ? 'success' : 'error' });
      if (r.exitoso) onDone();
    },
    // El backend rechaza con motivo legible si el splitter no entra en la caja
    // (guard de capacidad física). Se muestra tal cual: es información útil, no un error
    // genérico.
    onError: (err) => toast(parseApiError(err), { type: 'error' }),
  });

  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
        <div role="dialog" aria-modal="true"
          className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl"
          onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
                <Split className="w-4 h-4 text-primary" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">Instalar splitter en {nap.codigo}</h3>
            </div>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 space-y-3.5">
            <div className="rounded-lg bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
              La caja tiene {nap.capacidadPuertos} puertos físicos;{' '}
              {nap.puertosNoHabilitados} siguen sin splitter.
            </div>

            <div>
              <label className={labelCls}>Relación de división *</label>
              <select className={inputCls} value={relacion}
                onChange={(e) => setRelacion(e.target.value as SplitterRelacion)}>
                {RELACIONES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={onClose}
                className="flex-1 px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted">
                Cancelar
              </button>
              <button onClick={() => instalar.mutate()} disabled={instalar.isPending}
                className="flex-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2">
                {instalar.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Instalar
              </button>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}

// ─── Contenido principal ────────────────────────────────────────

export function CajasNapTab() {
  const qc = useQueryClient();
  const [crear, setCrear] = useState(false);
  const [splitterEn, setSplitterEn] = useState<Nap | null>(null);

  const { data: naps = [], isLoading, isError, error } = useQuery({
    queryKey: ['planta-externa-naps'],
    queryFn: () => plantaExternaApi.listarNaps(),
  });

  const refrescar = () => qc.invalidateQueries({ queryKey: ['planta-externa-naps'] });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Puntos de acceso de la red de distribución
        </p>
        <button onClick={() => setCrear(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
          <Plus className="w-4 h-4" /> Nueva caja
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

      {!isLoading && !isError && naps.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Box className="w-8 h-8 mb-2 opacity-40" />
          <p className="text-sm">Todavía no hay cajas NAP registradas</p>
        </div>
      )}

      {naps.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {naps.map((nap) => {
            const s = semaforo(nap);
            return (
              <div key={nap.id} className="rounded-xl border border-border bg-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{nap.codigo}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {nap.direccion || 'Sin dirección'}
                    </p>
                  </div>
                  <span className={cn('shrink-0 text-[10px] font-medium px-2 py-1 rounded-md border', s.color)}>
                    {s.texto}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span>{nap.capacidadPuertos} puertos</span>
                  <span className="opacity-40">·</span>
                  <span className="capitalize">{nap.estado}</span>
                  <BotonComoLlegar
                    latitud={nap.latitud} longitud={nap.longitud} etiqueta={nap.codigo}
                    className="ml-auto"
                  />
                </div>

                {nap.puertosNoHabilitados > 0 && (
                  <button onClick={() => setSplitterEn(nap)}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-foreground hover:bg-muted">
                    <Split className="w-3.5 h-3.5" /> Instalar splitter
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {crear && <CrearNapModal onClose={() => setCrear(false)} onCreated={() => { setCrear(false); refrescar(); }} />}
      {splitterEn && (
        <InstalarSplitterModal
          nap={splitterEn}
          onClose={() => setSplitterEn(null)}
          onDone={() => { setSplitterEn(null); refrescar(); }}
        />
      )}
    </div>
  );
}
