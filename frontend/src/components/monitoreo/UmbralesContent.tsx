'use client';

import { useState }                              from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings, Plus, Trash2, Pencil, X, Save, ChevronDown } from 'lucide-react';

import { dispositivosApi }   from '@/lib/api/monitoreo';
import { cn }                from '@/lib/utils';
import { useToast }          from '@/components/ui/toaster';

// ─── tipos ────────────────────────────────────────────────────
interface Dispositivo {
  id:         string;
  nombreEmisor: string;
  ipAddress:  string;
  tipoEquipo: string;
  fabricante: string;
}

interface UmbralItem {
  id:                      string;
  dispositivoId:           string | null;
  tipoEquipo:              string | null;
  nombre:                  string | null;
  latenciaMaxMs:           number | null;
  lossMaxPct:              number | null;
  cpuMaxPct:               number | null;
  memoryMaxPct:            number | null;
  trafficDownMaxBps:       string | null;
  trafficUpMaxBps:         string | null;
  nivelAlerta:             string;
  confirmacionesRequeridas: number;
  dispositivo?:            { nombreEmisor: string; tipoEquipo: string } | null;
}

const BLANK: Partial<UmbralItem> = {
  dispositivoId: null, tipoEquipo: null, nombre: '',
  latenciaMaxMs: null, lossMaxPct: null,
  cpuMaxPct: null, memoryMaxPct: null,
  trafficDownMaxBps: null, trafficUpMaxBps: null,
  nivelAlerta: 'WARNING', confirmacionesRequeridas: 3,
};

// ─── helpers ──────────────────────────────────────────────────
function Field({
  label, value, onChange, type = 'number', placeholder = '', nullable = true,
}: {
  label: string; value: string | number | null; type?: string;
  onChange: (v: string | null) => void; placeholder?: string; nullable?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs text-zinc-400 mb-1">{label}</label>
      <input
        type={type}
        placeholder={nullable ? 'Sin límite' : placeholder}
        value={value ?? ''}
        onChange={e => onChange(e.target.value === '' ? null : e.target.value)}
        className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg focus:outline-none focus:border-zinc-500 placeholder:text-zinc-600"
      />
    </div>
  );
}

// ─── formulario inline ────────────────────────────────────────
function UmbralForm({
  dispositivos, initial, onSave, onCancel, saving,
}: {
  dispositivos: Dispositivo[];
  initial: Partial<UmbralItem>;
  onSave:  (data: Partial<UmbralItem>) => void;
  onCancel: () => void;
  saving:  boolean;
}) {
  const [form, setForm] = useState<Partial<UmbralItem>>(initial);
  const selectedDispo   = dispositivos.find(d => d.id === form.dispositivoId);
  const isAntennaAP     = selectedDispo?.tipoEquipo === 'ANTENA_AP';

  const set = (key: keyof UmbralItem, v: any) => setForm(prev => ({ ...prev, [key]: v }));

  return (
    <div className="bg-zinc-800/80 border border-zinc-600 rounded-xl p-5 space-y-4">
      <p className="text-sm font-medium text-white">
        {initial.id ? 'Editar umbral' : 'Nuevo umbral'}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Dispositivo específico */}
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Dispositivo (opcional)</label>
          <div className="relative">
            <select
              value={form.dispositivoId ?? ''}
              onChange={e => set('dispositivoId', e.target.value || null)}
              className="w-full px-3 py-2 pr-8 text-sm bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg focus:outline-none focus:border-zinc-500 appearance-none"
            >
              <option value="">Global (todos)</option>
              {dispositivos.map(d => (
                <option key={d.id} value={d.id}>{d.nombreEmisor} · {d.ipAddress}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-2.5 h-4 w-4 text-zinc-500 pointer-events-none" />
          </div>
        </div>

        {/* Nombre descriptivo */}
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Nombre descriptivo</label>
          <input
            type="text"
            value={form.nombre ?? ''}
            onChange={e => set('nombre', e.target.value || null)}
            placeholder="Ej: Crítico AP centro"
            className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg focus:outline-none focus:border-zinc-500 placeholder:text-zinc-600"
          />
        </div>

        {/* Latencia */}
        <Field label="Latencia máx. (ms)" value={form.latenciaMaxMs ?? null}
          onChange={v => set('latenciaMaxMs', v ? parseInt(v) : null)} />

        {/* Pérdida */}
        <Field label="Pérdida máx. (%)" value={form.lossMaxPct ?? null}
          onChange={v => set('lossMaxPct', v ? parseInt(v) : null)} />

        {/* CPU */}
        <Field label="CPU máx. (%)" value={form.cpuMaxPct ?? null}
          onChange={v => set('cpuMaxPct', v ? parseInt(v) : null)} />

        {/* Memoria */}
        <Field label="Memoria máx. (%)" value={form.memoryMaxPct ?? null}
          onChange={v => set('memoryMaxPct', v ? parseInt(v) : null)} />

        {/* Tráfico Down — ocultar para ANTENA_AP es opcional, se muestra siempre */}
        <Field label="Tráfico bajada máx. (bps)" value={form.trafficDownMaxBps ?? null}
          onChange={v => set('trafficDownMaxBps', v)} />

        <Field label="Tráfico subida máx. (bps)" value={form.trafficUpMaxBps ?? null}
          onChange={v => set('trafficUpMaxBps', v)} />

        {/* Nivel alerta */}
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Nivel de alerta</label>
          <div className="relative">
            <select
              value={form.nivelAlerta ?? 'WARNING'}
              onChange={e => set('nivelAlerta', e.target.value)}
              className="w-full px-3 py-2 pr-8 text-sm bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg focus:outline-none focus:border-zinc-500 appearance-none"
            >
              <option value="WARNING">WARNING</option>
              <option value="CRITICA">CRITICA</option>
            </select>
            <ChevronDown className="absolute right-2 top-2.5 h-4 w-4 text-zinc-500 pointer-events-none" />
          </div>
        </div>

        {/* Confirmaciones */}
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Confirmaciones requeridas</label>
          <input
            type="number" min={1} max={10}
            value={form.confirmacionesRequeridas ?? 3}
            onChange={e => set('confirmacionesRequeridas', parseInt(e.target.value))}
            className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg focus:outline-none focus:border-zinc-500"
          />
        </div>
      </div>

      {isAntennaAP && (
        <p className="text-xs text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2">
          Antena AP: los umbrales de tráfico se aplican por interfaz inalámbrica. Los campos PPPoE/ONU no aplican.
        </p>
      )}

      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-zinc-700 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
        <button
          onClick={() => onSave(form)}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? 'Guardando...' : 'Guardar'}
        </button>
      </div>
    </div>
  );
}

// ─── componente principal ─────────────────────────────────────
export function UmbralesContent() {
  const [editId,    setEditId]    = useState<string | null>(null);
  const [showNew,   setShowNew]   = useState(false);
  const { toast }                 = useToast();
  const qc                        = useQueryClient();

  const { data: umbrales = [], isLoading: loadU } = useQuery<UmbralItem[]>({
    queryKey: ['monitoreo', 'umbrales'],
    queryFn:  () => dispositivosApi.getUmbrales(),
    staleTime: 30_000,
  });

  const { data: dispositivos = [] } = useQuery<Dispositivo[]>({
    queryKey: ['monitoreo', 'dispositivos'],
    queryFn:  () => dispositivosApi.getDispositivos(),
    staleTime: 60_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['monitoreo', 'umbrales'] });

  const { mutate: crear, isPending: creando } = useMutation({
    mutationFn: (dto: Partial<UmbralItem>) => dispositivosApi.createUmbral(dto),
    onSuccess: () => { toast('Umbral creado', { type: 'success' }); invalidate(); setShowNew(false); },
    onError:   (e: any) => toast(e?.message ?? 'Error al crear', { type: 'error' }),
  });

  const { mutate: actualizar, isPending: actualizando } = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: Partial<UmbralItem> }) =>
      dispositivosApi.updateUmbral(id, dto),
    onSuccess: () => { toast('Umbral actualizado', { type: 'success' }); invalidate(); setEditId(null); },
    onError:   (e: any) => toast(e?.message ?? 'Error al actualizar', { type: 'error' }),
  });

  const { mutate: eliminar } = useMutation({
    mutationFn: (id: string) => dispositivosApi.deleteUmbral(id),
    onSuccess: () => { toast('Umbral eliminado', { type: 'success' }); invalidate(); },
    onError:   (e: any) => toast(e?.message ?? 'Error al eliminar', { type: 'error' }),
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Umbrales de Alerta</h1>
          <p className="text-sm text-zinc-400 mt-0.5">
            Configura los límites que disparan alertas automáticas
          </p>
        </div>
        <button
          onClick={() => { setShowNew(true); setEditId(null); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Nuevo umbral
        </button>
      </div>

      {/* Formulario nuevo */}
      {showNew && (
        <UmbralForm
          dispositivos={dispositivos}
          initial={BLANK}
          onSave={dto => crear(dto)}
          onCancel={() => setShowNew(false)}
          saving={creando}
        />
      )}

      {/* Lista */}
      {loadU ? (
        <div className="flex items-center justify-center py-16 text-zinc-500 text-sm">
          <Settings className="h-5 w-5 animate-spin mr-2" />
          Cargando umbrales...
        </div>
      ) : umbrales.length === 0 && !showNew ? (
        <div className="bg-zinc-800/40 border border-dashed border-zinc-700 rounded-xl p-12 text-center">
          <Settings className="h-10 w-10 text-zinc-600 mx-auto mb-3" />
          <p className="text-zinc-300 font-medium">Sin umbrales configurados</p>
          <p className="text-zinc-500 text-sm mt-1 mb-5">
            Crea umbrales para recibir alertas cuando los dispositivos superen los límites
          </p>
          <button
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="h-4 w-4" />
            Crear primer umbral
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {umbrales.map(u => (
            <div key={u.id}>
              {editId === u.id ? (
                <UmbralForm
                  dispositivos={dispositivos}
                  initial={u}
                  onSave={dto => actualizar({ id: u.id, dto })}
                  onCancel={() => setEditId(null)}
                  saving={actualizando}
                />
              ) : (
                <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl px-4 py-3 flex items-start justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    {/* Título */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-white">
                        {u.nombre ?? (u.dispositivo?.nombreEmisor ?? 'Umbral global')}
                      </span>
                      <span className={cn(
                        'px-2 py-0.5 rounded-full text-[10px] font-medium',
                        u.nivelAlerta === 'CRITICA'
                          ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                          : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      )}>
                        {u.nivelAlerta}
                      </span>
                      {u.dispositivo?.tipoEquipo && (
                        <span className="text-[10px] text-zinc-500">
                          {u.dispositivo.tipoEquipo}
                        </span>
                      )}
                      <span className="text-xs text-zinc-500">
                        · {u.confirmacionesRequeridas} confirmacion{u.confirmacionesRequeridas !== 1 ? 'es' : ''}
                      </span>
                    </div>

                    {/* Valores */}
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-zinc-400">
                      {u.latenciaMaxMs   != null && <span>Latencia ≤ {u.latenciaMaxMs} ms</span>}
                      {u.lossMaxPct      != null && <span>Pérdida ≤ {u.lossMaxPct}%</span>}
                      {u.cpuMaxPct       != null && <span>CPU ≤ {u.cpuMaxPct}%</span>}
                      {u.memoryMaxPct    != null && <span>RAM ≤ {u.memoryMaxPct}%</span>}
                      {u.trafficDownMaxBps != null && <span>Down ≤ {Number(u.trafficDownMaxBps).toLocaleString()} bps</span>}
                      {u.trafficUpMaxBps   != null && <span>Up ≤ {Number(u.trafficUpMaxBps).toLocaleString()} bps</span>}
                      {[u.latenciaMaxMs, u.lossMaxPct, u.cpuMaxPct, u.memoryMaxPct, u.trafficDownMaxBps, u.trafficUpMaxBps].every(v => v == null) && (
                        <span className="text-zinc-600">Sin límites configurados</span>
                      )}
                    </div>
                  </div>

                  {/* Acciones */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => { setEditId(u.id); setShowNew(false); }}
                      className="p-1.5 rounded-lg hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        eliminar(u.id);
                      }}
                      className="p-1.5 rounded-lg hover:bg-red-500/20 text-zinc-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
