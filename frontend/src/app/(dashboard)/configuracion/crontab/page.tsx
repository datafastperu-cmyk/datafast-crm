'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Save, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import api from '@/lib/api';
import type { ApiRespuesta } from '@/types';
import { useToast } from '@/components/ui/toaster';

interface CronHorarios {
  facturacion:   string;
  corte:         string;
  recordatorio1: string;
  recordatorio2: string;
  recordatorio3: string;
}

interface CronData extends CronHorarios {
  ejecutoHoy?: Record<string, boolean>;
}

const DEFAULT: CronHorarios = {
  facturacion:   '05:00',
  corte:         '06:00',
  recordatorio1: '09:00',
  recordatorio2: '12:00',
  recordatorio3: '19:00',
};

// Devuelve true si la hora HH:MM ya pasó en Lima (UTC-5)
function yaPassoHoy(hora: string): boolean {
  const [h, m] = hora.split(':').map(Number);
  const ahora = new Date();
  // Lima = UTC-5
  const limaMs = ahora.getTime() - 5 * 60 * 60 * 1000;
  const lima   = new Date(limaMs);
  return lima.getUTCHours() > h || (lima.getUTCHours() === h && lima.getUTCMinutes() >= m);
}

async function fetchHorarios(): Promise<CronData> {
  const res = await api.get<ApiRespuesta<CronData>>('/admin/sistema/crontab');
  return res.data.data ?? DEFAULT;
}

async function saveHorarios(data: Partial<CronHorarios>): Promise<CronData> {
  const res = await api.patch<ApiRespuesta<CronData>>('/admin/sistema/crontab', data);
  return res.data.data;
}

function StatusBadge({ ejecuto, hora }: { ejecuto: boolean; hora: string }) {
  if (ejecuto) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700">
        <CheckCircle2 className="w-3 h-3" /> Ejecutó hoy
      </span>
    );
  }
  if (yaPassoHoy(hora)) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700">
        <AlertTriangle className="w-3 h-3" /> No ejecutó
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-600">
      <Clock className="w-3 h-3" /> Pendiente
    </span>
  );
}

function TimeInput({
  label,
  fieldKey,
  value,
  originalValue,
  ejecuto,
  onChange,
}: {
  label:         string;
  fieldKey:      string;
  value:         string;
  originalValue: string;
  ejecuto:       boolean;
  onChange:      (v: string) => void;
}) {
  const changed = value !== originalValue;

  return (
    <div className="flex items-center justify-between py-3.5 border-b border-border last:border-0 gap-3">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <StatusBadge ejecuto={ejecuto} hora={value} />
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <input
          type="time"
          value={value}
          onChange={e => onChange(e.target.value)}
          className={`border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-background transition-colors ${
            changed ? 'border-amber-400 ring-1 ring-amber-300' : 'border-border'
          }`}
        />
      </div>
    </div>
  );
}

function Panel({
  title,
  description,
  fields,
  form,
  original,
  ejecutoHoy,
  onChange,
  onSave,
  saving,
}: {
  title:       string;
  description: string;
  fields:      { key: keyof CronHorarios; label: string }[];
  form:        CronHorarios;
  original:    CronHorarios;
  ejecutoHoy:  Record<string, boolean>;
  onChange:    (k: keyof CronHorarios, v: string) => void;
  onSave:      (keys: (keyof CronHorarios)[]) => void;
  saving:      boolean;
}) {
  const hasChanges = fields.some(f => form[f.key] !== original[f.key]);

  // Aviso: algún campo que cambió ya ejecutó hoy → el nuevo horario aplica mañana
  const camposConConflicto = fields.filter(
    f => form[f.key] !== original[f.key] && ejecutoHoy[f.key],
  );

  // Aviso: campos sin cambio que ya pasaron su hora pero no ejecutaron
  const camposNoEjecutaron = fields.filter(
    f => !ejecutoHoy[f.key] && yaPassoHoy(form[f.key]),
  );

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="bg-gray-900 dark:bg-gray-800 text-white px-5 py-3">
        <p className="font-semibold text-sm tracking-wide">{title}</p>
        <p className="text-xs text-gray-400 mt-0.5">{description}</p>
      </div>

      <div className="px-5">
        {fields.map(f => (
          <TimeInput
            key={f.key}
            label={f.label}
            fieldKey={f.key}
            value={form[f.key]}
            originalValue={original[f.key]}
            ejecuto={!!ejecutoHoy[f.key]}
            onChange={v => onChange(f.key, v)}
          />
        ))}
      </div>

      {/* Aviso: tarea ya ejecutó, el cambio aplica mañana */}
      {camposConConflicto.length > 0 && (
        <div className="mx-5 mb-3 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5">
          <Info className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-700">
            <span className="font-semibold">Cambio aplica mañana.</span>{' '}
            {camposConConflicto.map(f => f.label).join(', ')}{' '}
            {camposConConflicto.length === 1 ? 'ya ejecutó' : 'ya ejecutaron'} hoy.
            El nuevo horario se activará en la próxima ejecución diaria.
          </p>
        </div>
      )}

      {/* Aviso: hora pasó pero no ejecutó (posible fallo) */}
      {camposNoEjecutaron.length > 0 && !hasChanges && (
        <div className="mx-5 mb-3 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
          <p className="text-xs text-red-700">
            <span className="font-semibold">Atención:</span>{' '}
            {camposNoEjecutaron.map(f => f.label).join(', ')}{' '}
            {camposNoEjecutaron.length === 1 ? 'debía ejecutar' : 'debían ejecutar'} hoy
            pero no hay registro de ejecución. Revisa los logs del servidor.
          </p>
        </div>
      )}

      <div className="px-5 py-4 flex justify-end border-t border-border">
        <button
          onClick={() => onSave(fields.map(f => f.key))}
          disabled={saving || !hasChanges}
          className="flex items-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-primary-foreground text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  );
}

export default function CrontabPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['crontab-horarios'],
    queryFn:  fetchHorarios,
    refetchInterval: 60_000, // refresca cada minuto para actualizar badges
  });

  const serverData: CronHorarios = data
    ? { facturacion: data.facturacion, corte: data.corte, recordatorio1: data.recordatorio1, recordatorio2: data.recordatorio2, recordatorio3: data.recordatorio3 }
    : DEFAULT;

  const [form, setForm] = useState<CronHorarios>(DEFAULT);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (data && !initialized) {
      setForm(serverData);
      setInitialized(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const ejecutoHoy: Record<string, boolean> = data?.ejecutoHoy ?? {};

  const { mutate, isPending } = useMutation({
    mutationFn: saveHorarios,
    onSuccess: (saved) => {
      setForm({
        facturacion:   saved.facturacion,
        corte:         saved.corte,
        recordatorio1: saved.recordatorio1,
        recordatorio2: saved.recordatorio2,
        recordatorio3: saved.recordatorio3,
      });
      qc.invalidateQueries({ queryKey: ['crontab-horarios'] });
      toast('Horarios actualizados correctamente', { type: 'success' });
    },
    onError: () => toast('Error al guardar los horarios', { type: 'error' }),
  });

  const handleChange = (k: keyof CronHorarios, v: string) => {
    setForm(prev => ({ ...prev, [k]: v }));
  };

  const handleSave = (keys: (keyof CronHorarios)[]) => {
    const payload = Object.fromEntries(keys.map(k => [k, form[k]])) as Partial<CronHorarios>;
    mutate(payload);
  };

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[300px]">
        <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Crontab</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Horarios de tareas automáticas (zona horaria: America/Lima). Los cambios aplican en el siguiente minuto exacto configurado.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Panel
          title="Notificaciones"
          description="WhatsApp de recordatorio previo al vencimiento"
          fields={[
            { key: 'recordatorio1', label: 'Recordatorio #1' },
            { key: 'recordatorio2', label: 'Recordatorio #2' },
            { key: 'recordatorio3', label: 'Recordatorio #3' },
          ]}
          form={form}
          original={serverData}
          ejecutoHoy={ejecutoHoy}
          onChange={handleChange}
          onSave={handleSave}
          saving={isPending}
        />

        <Panel
          title="Facturación & Corte"
          description="Generación de boletas y suspensión por mora"
          fields={[
            { key: 'facturacion', label: 'Crear facturas automáticas' },
            { key: 'corte',       label: 'Aplicar corte de servicio' },
          ]}
          form={form}
          original={serverData}
          ejecutoHoy={ejecutoHoy}
          onChange={handleChange}
          onSave={handleSave}
          saving={isPending}
        />
      </div>

      <div className="flex items-center justify-center gap-6 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Ejecutó hoy
        </span>
        <span className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-blue-500" /> Pendiente de ejecutar
        </span>
        <span className="flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Hora pasó sin ejecutar
        </span>
      </div>
    </div>
  );
}
