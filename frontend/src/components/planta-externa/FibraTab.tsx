'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Cable, Plus, X, Loader2, AlertCircle, ArrowRight } from 'lucide-react';

import {
  plantaExternaApi, extremoADto, HILOS_VALIDOS,
  type CrearSegmentoDto, type SegmentoJerarquia, type TipoInstalacion, type TipoNodo,
} from '@/lib/api/planta-externa';
import { sitesApi } from '@/lib/api/sites';
import { useToast } from '@/components/ui/toaster';
import { Portal } from '@/components/ui/portal';
import { parseApiError, cn } from '@/lib/utils';

const inputCls = 'w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors';
const labelCls = 'text-xs font-medium text-muted-foreground block mb-1';

/** Color por jerarquía — el mismo criterio que usará el visor cartográfico. */
const JERARQUIA_COLOR: Record<SegmentoJerarquia, string> = {
  troncal:      'text-red-500 bg-red-500/10 border-red-500/20',
  subtroncal:   'text-blue-500 bg-blue-500/10 border-blue-500/20',
  distribucion: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20',
};

const JERARQUIA_LABEL: Record<SegmentoJerarquia, string> = {
  troncal:      'Troncal (feeder)',
  subtroncal:   'Sub-troncal',
  distribucion: 'Distribución',
};

/**
 * Selector de extremo: tipo de nodo + elemento concreto.
 *
 * El backend admite site, mufa o NAP y exige exactamente uno (CHECK en la BD). El
 * formulario lo expresa como el operador lo piensa —"de la mufa X a la caja Y"— en vez de
 * seis campos donde cinco quedan vacíos.
 */
function SelectorExtremo({
  label, tipo, id, onTipo, onId, sites, mufas, naps,
}: {
  label: string;
  tipo: TipoNodo;
  id: string;
  onTipo: (_tipo: TipoNodo) => void;
  onId: (_id: string) => void;
  sites: { id: string; nombre: string }[];
  mufas: { id: string; codigo: string }[];
  naps:  { id: string; codigo: string }[];
}) {
  const opciones =
    tipo === 'site' ? sites.map((s) => ({ id: s.id, label: s.nombre }))
    : tipo === 'mufa' ? mufas.map((m) => ({ id: m.id, label: m.codigo }))
    : naps.map((n) => ({ id: n.id, label: n.codigo }));

  return (
    <div>
      <label className={labelCls}>{label} *</label>
      <div className="grid grid-cols-2 gap-2">
        <select className={inputCls} value={tipo}
          onChange={(e) => { onTipo(e.target.value as TipoNodo); onId(''); }}>
          <option value="site">Site</option>
          <option value="mufa">Mufa</option>
          <option value="nap">Caja NAP</option>
        </select>
        <select className={inputCls} value={id} onChange={(e) => onId(e.target.value)}>
          <option value="">— elegir —</option>
          {opciones.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
      {opciones.length === 0 && (
        <p className="text-[11px] text-amber-500 mt-1">
          No hay elementos de este tipo todavía. Créalos primero en su pestaña.
        </p>
      )}
    </div>
  );
}

function CrearSegmentoModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();

  const [form, setForm] = useState<Partial<CrearSegmentoDto>>({
    jerarquia: 'troncal', hilosTotales: 12, tipoInstalacion: 'aereo',
  });
  const [origen,  setOrigen]  = useState<{ tipo: TipoNodo; id: string }>({ tipo: 'site', id: '' });
  const [destino, setDestino] = useState<{ tipo: TipoNodo; id: string }>({ tipo: 'mufa', id: '' });

  const { data: sites = [] } = useQuery({ queryKey: ['sites-lista'],           queryFn: () => sitesApi.listar() });
  const { data: mufas = [] } = useQuery({ queryKey: ['planta-externa-mufas'],  queryFn: () => plantaExternaApi.listarMufas() });
  const { data: naps  = [] } = useQuery({ queryKey: ['planta-externa-naps'],   queryFn: () => plantaExternaApi.listarNaps() });

  const crear = useMutation({
    mutationFn: () => plantaExternaApi.crearSegmento({
      codigo:          form.codigo!.trim(),
      jerarquia:       form.jerarquia!,
      hilosTotales:    Number(form.hilosTotales),
      longitudM:       Number(form.longitudM),
      tipoInstalacion: form.tipoInstalacion,
      descripcion:     form.descripcion?.trim() || undefined,
      ...extremoADto('origen',  origen.tipo,  origen.id),
      ...extremoADto('destino', destino.tipo, destino.id),
    } as CrearSegmentoDto),
    onSuccess: (r) => {
      toast(r.mensaje || 'Segmento creado', { type: r.exitoso ? 'success' : 'error' });
      if (r.exitoso) onCreated();
    },
    onError: (err) => toast(parseApiError(err), { type: 'error' }),
  });

  // Un segmento que empieza y termina en el mismo nodo es un lazo: el recorrido del grafo
  // tendría que detectarlo en tiempo de consulta en vez de impedirlo aquí.
  const mismoNodo = origen.tipo === destino.tipo && origen.id === destino.id && origen.id !== '';

  const valido =
    !!form.codigo?.trim() && !!origen.id && !!destino.id && !mismoNodo &&
    Number(form.longitudM) > 0;

  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto" onClick={onClose}>
        <div role="dialog" aria-modal="true"
          className="w-full max-w-lg my-8 bg-card border border-border rounded-2xl shadow-2xl"
          onClick={(e) => e.stopPropagation()}>

          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
                <Cable className="w-4 h-4 text-primary" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">Nuevo tendido de fibra</h3>
            </div>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); if (valido) crear.mutate(); }} className="p-5 space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Código *</label>
                <input className={inputCls} placeholder="TR-001"
                  value={form.codigo ?? ''}
                  onChange={(e) => setForm({ ...form, codigo: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>Jerarquía *</label>
                <select className={inputCls} value={form.jerarquia}
                  onChange={(e) => setForm({ ...form, jerarquia: e.target.value as SegmentoJerarquia })}>
                  {(Object.keys(JERARQUIA_LABEL) as SegmentoJerarquia[]).map((j) => (
                    <option key={j} value={j}>{JERARQUIA_LABEL[j]}</option>
                  ))}
                </select>
              </div>
            </div>

            <SelectorExtremo label="Desde" tipo={origen.tipo} id={origen.id}
              onTipo={(t) => setOrigen({ tipo: t, id: '' })} onId={(v) => setOrigen({ ...origen, id: v })}
              sites={sites} mufas={mufas} naps={naps} />

            <SelectorExtremo label="Hasta" tipo={destino.tipo} id={destino.id}
              onTipo={(t) => setDestino({ tipo: t, id: '' })} onId={(v) => setDestino({ ...destino, id: v })}
              sites={sites} mufas={mufas} naps={naps} />

            {mismoNodo && (
              <p className="text-[11px] text-destructive">
                El origen y el destino no pueden ser el mismo elemento.
              </p>
            )}

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Hilos *</label>
                <select className={inputCls} value={form.hilosTotales}
                  onChange={(e) => setForm({ ...form, hilosTotales: Number(e.target.value) })}>
                  {HILOS_VALIDOS.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Metros *</label>
                <input className={inputCls} type="number" min={1} placeholder="850"
                  value={form.longitudM ?? ''}
                  onChange={(e) => setForm({ ...form, longitudM: Number(e.target.value) })} />
              </div>
              <div>
                <label className={labelCls}>Instalación</label>
                <select className={inputCls} value={form.tipoInstalacion}
                  onChange={(e) => setForm({ ...form, tipoInstalacion: e.target.value as TipoInstalacion })}>
                  <option value="aereo">Aéreo</option>
                  <option value="subterraneo">Subterráneo</option>
                  <option value="fachada">Fachada</option>
                </select>
              </div>
            </div>

            {/* La longitud no es decorativa: entra en el cálculo de pérdida óptica, que es
                lo que después permite detectar una fusión sucia comparando contra la
                potencia real de la ONU. */}
            <p className="text-[11px] text-muted-foreground">
              Los {form.hilosTotales} hilos se crean automáticamente con su color EIA-598.
              La longitud entra en el cálculo de pérdida óptica.
            </p>

            {/* Texto libre. En un tendido es donde se anota el recorrido real —"por la
                azotea del edificio 4", "cruza la avenida por el semáforo"—, que es lo que
                el cuadrilla necesita para encontrarlo y que ningún campo estructurado
                puede representar hasta que se levante el trazado. */}
            <div>
              <label className={labelCls}>Notas del operador</label>
              <textarea className={cn(inputCls, 'resize-none h-16')}
                placeholder="Recorrido real, propietario del poste, permisos, observaciones…"
                value={form.descripcion ?? ''}
                onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />
            </div>

            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose}
                className="flex-1 px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted">
                Cancelar
              </button>
              <button type="submit" disabled={!valido || crear.isPending}
                className="flex-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2">
                {crear.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Crear tendido
              </button>
            </div>
          </form>
        </div>
      </div>
    </Portal>
  );
}

export function FibraTab() {
  const qc = useQueryClient();
  const [crear, setCrear] = useState(false);

  const { data: segmentos = [], isLoading, isError, error } = useQuery({
    queryKey: ['planta-externa-segmentos'],
    queryFn:  () => plantaExternaApi.listarSegmentos(),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Tendidos de cable óptico y sus hilos
        </p>
        <button onClick={() => setCrear(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
          <Plus className="w-4 h-4" /> Nuevo tendido
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

      {!isLoading && !isError && segmentos.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Cable className="w-8 h-8 mb-2 opacity-40" />
          <p className="text-sm">Todavía no hay tendidos registrados</p>
        </div>
      )}

      {segmentos.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {segmentos.map((s) => (
            <div key={s.id} className="rounded-xl border border-border bg-card p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-foreground truncate">{s.codigo}</p>
                <span className={cn('shrink-0 text-[10px] font-medium px-2 py-1 rounded-md border',
                  JERARQUIA_COLOR[s.jerarquia])}>
                  {JERARQUIA_LABEL[s.jerarquia]}
                </span>
              </div>

              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>{s.hilosTotales} hilos</span>
                <span className="opacity-40">·</span>
                <span>{Number(s.longitudM).toFixed(0)} m</span>
                <span className="opacity-40">·</span>
                <span className="capitalize">{s.tipoInstalacion}</span>
              </div>

              {/* Un tendido sin trazado levantado se dibujará punteado en el mapa: muestra
                  la conectividad sin afirmar por dónde va el cable. Se avisa desde aquí
                  para que el operador sepa que falta trabajo de campo. */}
              {!s.rutaGeojson && (
                <p className="text-[11px] text-amber-500 inline-flex items-center gap-1">
                  <ArrowRight className="w-3 h-3" /> Trazado no levantado
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {crear && (
        <CrearSegmentoModal
          onClose={() => setCrear(false)}
          onCreated={() => { setCrear(false); qc.invalidateQueries({ queryKey: ['planta-externa-segmentos'] }); }}
        />
      )}
    </div>
  );
}
