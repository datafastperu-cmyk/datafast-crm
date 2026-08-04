'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Loader2, GitMerge, Split, Trash2, Link2, AlertCircle } from 'lucide-react';

import {
  plantaExternaApi,
  type FibraHilo, type MufaDetalle, type SplitterRelacion,
} from '@/lib/api/planta-externa';
import { useToast } from '@/components/ui/toaster';
import { Portal } from '@/components/ui/portal';
import { parseApiError, cn } from '@/lib/utils';

/**
 * Color real de cada hilo según EIA-598.
 *
 * No es decoración: el técnico frente a la caja identifica el hilo por su color, no por
 * su número. Mostrar sólo "hilo 7" lo obliga a traducir mentalmente contra una tabla, y
 * ahí es donde se fusiona el hilo equivocado.
 */
const COLOR_HILO: Record<string, string> = {
  azul:       '#2563eb',
  naranja:    '#ea580c',
  verde:      '#16a34a',
  marron:     '#78350f',
  gris:       '#6b7280',
  blanco:     '#e5e7eb',
  rojo:       '#dc2626',
  negro:      '#111827',
  amarillo:   '#eab308',
  violeta:    '#7c3aed',
  rosa:       '#ec4899',
  aguamarina: '#06b6d4',
};

const RELACIONES: SplitterRelacion[] = ['1x2', '1x4', '1x8', '1x16', '1x32'];

interface Props {
  mufaId: string;
  onClose: () => void;
}

export function MufaDetalleModal({ mufaId, onClose }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  /** Hilos seleccionados para fusionar. Máximo dos: una fusión une exactamente dos. */
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [relacionSplitter, setRelacionSplitter] = useState<SplitterRelacion>('1x8');
  const [descripcionSplitter, setDescripcionSplitter] = useState('');
  /** Pérdida medida con la fusionadora; vacío usa el valor típico del backend. */
  const [obsFusion, setObsFusion] = useState('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['mufa-detalle', mufaId],
    queryFn:  () => plantaExternaApi.detalleMufa(mufaId),
  });

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['mufa-detalle', mufaId] });
    qc.invalidateQueries({ queryKey: ['planta-externa-segmentos'] });
  };

  const fusionar = useMutation({
    mutationFn: () => plantaExternaApi.crearFusion(mufaId, {
      hiloAId: seleccion[0], hiloBId: seleccion[1],
      observacion: obsFusion.trim() || undefined,
    }),
    onSuccess: (r) => {
      toast(r.mensaje || r.error || '', { type: r.exitoso ? 'success' : 'error' });
      if (r.exitoso) { setSeleccion([]); setObsFusion(''); refrescar(); }
    },
    onError: (err) => toast(parseApiError(err), { type: 'error' }),
  });

  const deshacer = useMutation({
    mutationFn: (fusionId: string) => plantaExternaApi.eliminarFusion(fusionId),
    onSuccess: (r) => {
      toast(r.mensaje || 'Fusión deshecha', { type: r.exitoso ? 'success' : 'error' });
      if (r.exitoso) refrescar();
    },
    onError: (err) => toast(parseApiError(err), { type: 'error' }),
  });

  const instalarSplitter = useMutation({
    mutationFn: () => plantaExternaApi.instalarSplitterEnMufa(mufaId, {
      relacion: relacionSplitter,
      descripcion: descripcionSplitter.trim() || undefined,
    }),
    onSuccess: (r) => {
      toast(r.mensaje || r.error || '', { type: r.exitoso ? 'success' : 'error' });
      if (r.exitoso) refrescar();
    },
    onError: (err) => toast(parseApiError(err), { type: 'error' }),
  });

  const toggleHilo = (hilo: FibraHilo) => {
    // Un hilo ya fusionado no se puede volver a seleccionar: el invariante es que se
    // fusiona una sola vez. Dejar clicarlo y rechazarlo después sería hacerle perder el
    // viaje al operador.
    if (hilo.estado === 'en_uso') return;
    setSeleccion((prev) =>
      prev.includes(hilo.id)
        ? prev.filter((id) => id !== hilo.id)
        : prev.length >= 2 ? [prev[1], hilo.id] : [...prev, hilo.id],
    );
  };

  const d: MufaDetalle | undefined = data;
  const hilosPorId = new Map((d?.hilos ?? []).map((h) => [h.id, h]));
  const segmentoPorId = new Map((d?.segmentos ?? []).map((s) => [s.id, s]));

  const etiquetaHilo = (id: string) => {
    const h = hilosPorId.get(id);
    if (!h) return '—';
    const seg = segmentoPorId.get(h.segmentoId);
    return `${seg?.codigo ?? '?'} · hilo ${h.numero}${h.color ? ` (${h.color})` : ''}`;
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto"
        onClick={onClose}>
        <div role="dialog" aria-modal="true"
          className="w-full max-w-3xl my-8 bg-card border border-border rounded-2xl shadow-2xl"
          onClick={(e) => e.stopPropagation()}>

          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
                <GitMerge className="w-4 h-4 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  {d?.mufa.codigo ?? 'Mufa'}
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  {d?.mufa.direccion || 'Sin dirección'}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          )}

          {isError && (
            <div className="m-5 flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3">
              <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-destructive">{parseApiError(error)}</p>
            </div>
          )}

          {d && (
            <div className="p-5 space-y-5">

              {/* ── Cables que llegan ────────────────────────────── */}
              <section>
                <h4 className="text-xs font-semibold text-foreground mb-2">
                  Cables que llegan ({d.segmentos.length})
                </h4>

                {d.segmentos.length === 0 ? (
                  // Sin cables no hay nada que fusionar. Decirlo explícitamente evita que
                  // el operador crea que la pantalla está rota.
                  <p className="text-xs text-muted-foreground py-3">
                    Ningún tendido llega a esta mufa todavía. Créalo en la pestaña Fibra
                    eligiendo esta mufa como origen o destino.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {d.segmentos.map((seg) => {
                      const suyos = d.hilos.filter((h) => h.segmentoId === seg.id);
                      return (
                        <div key={seg.id} className="rounded-lg border border-border p-3">
                          <p className="text-[11px] font-medium text-foreground mb-2">
                            {seg.codigo}
                            <span className="text-muted-foreground font-normal">
                              {' '}· {seg.hilosTotales} hilos · {Number(seg.longitudM).toFixed(0)} m
                            </span>
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {suyos.map((h) => {
                              const sel = seleccion.includes(h.id);
                              const usado = h.estado === 'en_uso';
                              return (
                                <button
                                  key={h.id}
                                  onClick={() => toggleHilo(h)}
                                  disabled={usado}
                                  title={`Hilo ${h.numero}${h.color ? ` — ${h.color}` : ''}${usado ? ' (ya fusionado)' : ''}`}
                                  className={cn(
                                    'w-8 h-8 rounded-md border-2 text-[10px] font-bold transition-all',
                                    'flex items-center justify-center',
                                    sel   && 'ring-2 ring-primary ring-offset-1 ring-offset-card scale-110',
                                    usado && 'opacity-30 cursor-not-allowed',
                                  )}
                                  style={{
                                    backgroundColor: COLOR_HILO[h.color ?? ''] ?? '#9ca3af',
                                    borderColor: sel ? 'var(--primary)' : 'transparent',
                                    color: ['blanco', 'amarillo', 'gris'].includes(h.color ?? '')
                                      ? '#111827' : '#ffffff',
                                  }}
                                >
                                  {h.numero}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* ── Acción de fusión ─────────────────────────────── */}
              {d.segmentos.length > 0 && (
                <section className="rounded-lg bg-muted/40 border border-border p-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-[11px] text-muted-foreground">
                      {seleccion.length === 0 && 'Selecciona dos hilos para fusionarlos.'}
                      {seleccion.length === 1 && `Seleccionado: ${etiquetaHilo(seleccion[0])}. Elige el segundo.`}
                      {seleccion.length === 2 && (
                        <span className="text-foreground">
                          {etiquetaHilo(seleccion[0])} ↔ {etiquetaHilo(seleccion[1])}
                        </span>
                      )}
                    </p>
                    <div className="flex items-center gap-2">
                      {/* Observación del empalme: qué se hizo y por qué. Un "reempalmada
                          tras corte del 12/03" explica meses después por qué esa fusión
                          tiene más pérdida que sus vecinas. */}
                      <input
                        className="w-52 bg-background border border-input rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60"
                        placeholder="Observación del empalme…"
                        value={obsFusion}
                        onChange={(e) => setObsFusion(e.target.value)}
                      />
                      <button
                        onClick={() => fusionar.mutate()}
                        disabled={seleccion.length !== 2 || fusionar.isPending}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-40"
                      >
                        {fusionar.isPending
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Link2 className="w-3.5 h-3.5" />}
                        Fusionar
                      </button>
                    </div>
                  </div>
                </section>
              )}

              {/* ── Matriz de fusiones ───────────────────────────── */}
              <section>
                <h4 className="text-xs font-semibold text-foreground mb-2">
                  Fusiones ({d.fusiones.length})
                </h4>
                {d.fusiones.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">Sin fusiones registradas.</p>
                ) : (
                  <div className="space-y-1.5">
                    {d.fusiones.map((f) => (
                      <div key={f.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                        <p className="text-[11px] text-foreground min-w-0 truncate">
                          {etiquetaHilo(f.hiloAId)}
                          <span className="text-muted-foreground mx-1.5">↔</span>
                          {etiquetaHilo(f.hiloBId)}
                          <span className="text-muted-foreground ml-2">
                            {Number(f.perdidaDb).toFixed(2)} dB
                          </span>
                        </p>
                        <button
                          onClick={() => deshacer.mutate(f.id)}
                          disabled={deshacer.isPending}
                          className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          title="Deshacer fusión"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* ── Splitters internos ───────────────────────────── */}
              <section>
                <h4 className="text-xs font-semibold text-foreground mb-2">
                  Splitters internos ({d.splitters.length})
                </h4>

                {d.splitters.length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    {d.splitters.map((s) => (
                      <div key={s.id}
                        className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-[11px]">
                        <Split className="w-3.5 h-3.5 text-primary shrink-0" />
                        <span className="font-medium text-foreground">{s.relacion}</span>
                        <span className="text-muted-foreground">
                          {Number(s.perdidaDb).toFixed(2)} dB de pérdida
                        </span>
                        {s.codigo && <span className="text-muted-foreground">· {s.codigo}</span>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Texto libre del splitter: marca, modelo, serie, bandeja. Es lo que
                    ninguna columna estructurada captura y que el técnico necesita al
                    abrir la mufa. */}
                <input
                  className="w-full mb-2 bg-background border border-input rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60"
                  placeholder="Notas: marca, modelo, serie, bandeja…"
                  value={descripcionSplitter}
                  onChange={(e) => setDescripcionSplitter(e.target.value)}
                />

                <div className="flex items-center gap-2">
                  <select
                    className="bg-background border border-input rounded-lg px-2.5 py-1.5 text-xs text-foreground"
                    value={relacionSplitter}
                    onChange={(e) => setRelacionSplitter(e.target.value as SplitterRelacion)}
                  >
                    {RELACIONES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <button
                    onClick={() => instalarSplitter.mutate()}
                    disabled={instalarSplitter.isPending}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-foreground hover:bg-muted disabled:opacity-40"
                  >
                    {instalarSplitter.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Instalar splitter
                  </button>
                </div>
                {/* Una derivación por fusión suma ~0.1 dB; un 1x8 suma ~10.5 dB. La
                    diferencia es de un orden de magnitud y es lo que hace que el
                    presupuesto óptico sirva para algo. */}
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Un splitter divide la potencia: un 1x8 cuesta ~10.5 dB, una fusión ~0.1 dB.
                </p>
              </section>
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
}
