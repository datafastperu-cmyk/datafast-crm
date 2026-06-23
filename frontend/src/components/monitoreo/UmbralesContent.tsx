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

const INPUT = 'w-full px-3 py-2 text-sm bg-background border border-input text-foreground rounded-lg focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground';
const SELECT = `${INPUT} appearance-none pr-8`;

// ─── helpers ──────────────────────────────────────────────────
function Field({
  label, value, onChange, type = 'number', placeholder = '', nullable = true,
}: {
  label: string; value: string | number | null; type?: string;
  onChange: (v: string | null) => void; placeholder?: string; nullable?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground mb-1">{label}</label>
      <input
        type={type}
        placeholder={nullable ? 'Sin límite' : placeholder}
        value={value ?? ''}
        onChange={e => onChange(e.target.value === '' ? null : e.target.value)}
        className={INPUT}
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
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <p className="text-sm font-medium text-foreground">
        {initial.id ? 'Editar umbral' : 'Nuevo umbral'}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Dispositivo específico */}
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Dispositivo (opcional)</label>
          <div className="relative">
            <select
              value={form.dispositivoId ?? ''}
              onChange={e => set('dispositivoId', e.target.value || null)}
              className={SELECT}
            >
              <option value="">Global (todos)</option>
              {dispositivos.map(d => (
                <option key={d.id} value={d.id}>{d.nombreEmisor} · {d.ipAddress}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        {/* Nombre descriptivo */}
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Nombre descriptivo</label>
          <input
            type="text"
            value={form.nombre ?? ''}
            onChange={e => set('nombre', e.target.value || null)}
            placeholder="Ej: Crítico AP centro"
            className={INPUT}
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

        <Field label="Tráfico bajada máx. (bps)" value={form.trafficDownMaxBps ?? null}
          onChange={v => set('trafficDownMaxBps', v)} />

        <Field label="Tráfico subida máx. (bps)" value={form.trafficUpMaxBps ?? null}
          onChange={v => set('trafficUpMaxBps', v)} />

        {/* Nivel alerta */}
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Nivel de alerta</label>
          <div className="relative">
            <select
              value={form.nivelAlerta ?? 'WARNING'}
              onChange={e => set('nivelAlerta', e.target.value)}
              className={SELECT}
            >
              <option value="WARNING">WARNING</option>
              <option value="CRITICA">CRITICA</option>
            </select>
            <ChevronDown className="absolute right-2 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        {/* Confirmaciones */}
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Confirmaciones requeridas</label>
          <input
            type="number" min={1} max={10}
            value={form.confirmacionesRequeridas ?? 3}
            onChange={e => set('confirmacionesRequeridas', parseInt(e.target.value))}
            className={INPUT}
          />
        </div>
      </div>

      {isAntennaAP && (
        <p className="text-xs text-blue-700 dark:text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2">
          Antena AP: los umbrales de tráfico se aplican por interfaz inalámbrica. Los campos PPPoE/ONU no aplican.
        </p>
      )}

      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
        <button
          onClick={() => onSave(form)}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium btn-primary rounded-lg transition-colors disabled:opacity-50"
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
          <h1 className="text-xl font-semibold text-foreground">Umbrales de Alerta</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configura los límites que disparan alertas automáticas
          </p>
        </div>
        <button
          onClick={() => { setShowNew(true); setEditId(null); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg btn-primary text-sm font-medium transition-colors"
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
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
          <Settings className="h-5 w-5 animate-spin mr-2" />
          Cargando umbrales...
        </div>
      ) : umbrales.length === 0 && !showNew ? (
        <div className="bg-muted/20 border border-dashed border-border rounded-xl p-12 text-center">
          <Settings className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
          <p className="text-foreground font-medium">Sin umbrales configurados</p>
          <p className="text-muted-foreground text-sm mt-1 mb-5">
            Crea umbrales para recibir alertas cuando los dispositivos superen los límites
          </p>
          <button
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-2 px-4 py-2 btn-primary text-sm font-medium rounded-lg transition-colors"
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
                <div className="bg-card border border-border rounded-xl px-4 py-3 flex items-start justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    {/* Título */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground">
                        {u.nombre ?? (u.dispositivo?.nombreEmisor ?? 'Umbral global')}
                      </span>
                      <span className={cn(
                        'px-2 py-0.5 rounded-full text-[10px] font-medium',
                        u.nivelAlerta === 'CRITICA'
                          ? 'bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30'
                          : 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                      )}>
                        {u.nivelAlerta}
                      </span>
                      {u.dispositivo?.tipoEquipo && (
                        <span className="text-[10px] text-muted-foreground/70">
                          {u.dispositivo.tipoEquipo}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground/70">
                        · {u.confirmacionesRequeridas} confirmacion{u.confirmacionesRequeridas !== 1 ? 'es' : ''}
                      </span>
                    </div>

                    {/* Valores */}
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                      {u.latenciaMaxMs   != null && <span>Latencia ≤ {u.latenciaMaxMs} ms</span>}
                      {u.lossMaxPct      != null && <span>Pérdida ≤ {u.lossMaxPct}%</span>}
                      {u.cpuMaxPct       != null && <span>CPU ≤ {u.cpuMaxPct}%</span>}
                      {u.memoryMaxPct    != null && <span>RAM ≤ {u.memoryMaxPct}%</span>}
                      {u.trafficDownMaxBps != null && <span>Down ≤ {Number(u.trafficDownMaxBps).toLocaleString()} bps</span>}
                      {u.trafficUpMaxBps   != null && <span>Up ≤ {Number(u.trafficUpMaxBps).toLocaleString()} bps</span>}
                      {[u.latenciaMaxMs, u.lossMaxPct, u.cpuMaxPct, u.memoryMaxPct, u.trafficDownMaxBps, u.trafficUpMaxBps].every(v => v == null) && (
                        <span className="text-muted-foreground/50">Sin límites configurados</span>
                      )}
                    </div>
                  </div>

                  {/* Acciones */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => { setEditId(u.id); setShowNew(false); }}
                      className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => eliminar(u.id)}
                      className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
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
