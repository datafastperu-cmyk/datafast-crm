'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Save } from 'lucide-react';
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

const DEFAULT: CronHorarios = {
  facturacion:   '05:00',
  corte:         '06:00',
  recordatorio1: '09:00',
  recordatorio2: '12:00',
  recordatorio3: '19:00',
};

async function fetchHorarios(): Promise<CronHorarios> {
  const res = await api.get<ApiRespuesta<CronHorarios>>('/admin/sistema/crontab');
  return res.data.data ?? DEFAULT;
}

async function saveHorarios(data: Partial<CronHorarios>): Promise<CronHorarios> {
  const res = await api.patch<ApiRespuesta<CronHorarios>>('/admin/sistema/crontab', data);
  return res.data.data;
}

function TimeInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between py-4 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-700 font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="time"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        />
        <Clock className="w-4 h-4 text-gray-400" />
      </div>
    </div>
  );
}

function Panel({
  title,
  fields,
  form,
  onChange,
  onSave,
  saving,
}: {
  title:    string;
  fields:   { key: keyof CronHorarios; label: string }[];
  form:     CronHorarios;
  onChange: (k: keyof CronHorarios, v: string) => void;
  onSave:   (keys: (keyof CronHorarios)[]) => void;
  saving:   boolean;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="bg-gray-900 text-white px-5 py-3 font-semibold text-sm tracking-wide">
        {title}
      </div>
      <div className="px-5">
        {fields.map(f => (
          <TimeInput
            key={f.key}
            label={f.label}
            value={form[f.key]}
            onChange={v => onChange(f.key, v)}
          />
        ))}
      </div>
      <div className="px-5 py-4 flex justify-end">
        <button
          onClick={() => onSave(fields.map(f => f.key))}
          disabled={saving}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Save className="w-4 h-4" />
          Guardar cambios
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
  });

  const [form, setForm] = useState<CronHorarios>(DEFAULT);

  // Sync form when data loads
  if (data && form.facturacion === DEFAULT.facturacion && data.facturacion !== DEFAULT.facturacion) {
    setForm(data);
  }
  const horarios = data ? { ...DEFAULT, ...data, ...form } : { ...DEFAULT, ...form };

  const { mutate, isPending } = useMutation({
    mutationFn: saveHorarios,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crontab-horarios'] });
      toast('Horarios actualizados correctamente', { type: 'success' });
    },
    onError: () => toast('Error al guardar los horarios', { type: 'error' }),
  });

  const handleChange = (k: keyof CronHorarios, v: string) => {
    setForm(prev => ({ ...prev, [k]: v }));
  };

  const handleSave = (keys: (keyof CronHorarios)[]) => {
    const payload = Object.fromEntries(keys.map(k => [k, horarios[k]])) as Partial<CronHorarios>;
    mutate(payload);
  };

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[300px]">
        <div className="animate-spin w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Crontab</h1>
        <p className="text-sm text-gray-500 mt-1">
          Configura los horarios de ejecución de tareas automáticas (hora Lima / America/Lima).
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Panel
          title="Notificaciones"
          fields={[
            { key: 'recordatorio1', label: 'Recordatorio de pago #1' },
            { key: 'recordatorio2', label: 'Recordatorio de pago #2' },
            { key: 'recordatorio3', label: 'Recordatorio de pago #3' },
          ]}
          form={horarios}
          onChange={handleChange}
          onSave={handleSave}
          saving={isPending}
        />

        <Panel
          title="Facturación & Corte"
          fields={[
            { key: 'corte',        label: 'Aplicar corte de servicio' },
            { key: 'facturacion',  label: 'Crear facturas automáticas' },
          ]}
          form={horarios}
          onChange={handleChange}
          onSave={handleSave}
          saving={isPending}
        />
      </div>

      <p className="text-xs text-gray-400 text-center">
        Los cambios se aplican en el siguiente minuto exacto configurado. No requiere reiniciar el servidor.
      </p>
    </div>
  );
}
