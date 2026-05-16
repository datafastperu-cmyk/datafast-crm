'use client';

import { useState }       from 'react';
import { useRouter }      from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm }        from 'react-hook-form';
import { zodResolver }    from '@hookform/resolvers/zod';
import { z }              from 'zod';
import {
  ArrowLeft, Plus, Trash2, Bell, Loader2,
} from 'lucide-react';

import { monitoreoApi, METRICAS_ALERTA } from '@/lib/api/monitoreo';
import { useToast }    from '@/components/ui/toaster';
import { parseApiError, cn } from '@/lib/utils';

const schema = z.object({
  nodoId:           z.string().optional(),
  metrica:          z.string().min(1, 'Selecciona una métrica'),
  umbralWarning:    z.coerce.number().min(0, 'Mínimo 0'),
  umbralCritical:   z.coerce.number().min(0, 'Mínimo 0'),
  notificarWhatsapp: z.boolean().optional(),
  telefonoDestino:  z.string().optional(),
  descripcion:      z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

// Valores por defecto por métrica
const DEFAULTS: Record<string, { warning: number; critical: number }> = {
  ping_latencia:  { warning: 100,  critical: 300 },
  ping_perdida:   { warning: 5,    critical: 20 },
  cpu:            { warning: 80,   critical: 95 },
  memoria:        { warning: 80,   critical: 95 },
  temperatura:    { warning: 65,   critical: 80 },
  trafico_bajada: { warning: 800_000_000, critical: 950_000_000 },
  trafico_subida: { warning: 800_000_000, critical: 950_000_000 },
  sesiones_pppoe: { warning: 200,  critical: 250 },
  senal_onu:      { warning: -25,  critical: -28 },
};

export function ConfiguracionAlertas() {
  const router      = useRouter();
  const queryClient = useQueryClient();
  const { toast }   = useToast();
  const [showForm, setShowForm] = useState(false);

  const { data: configs = [], isLoading } = useQuery({
    queryKey: ['config-alertas'],
    queryFn:  monitoreoApi.getConfigAlertas,
  });

  const { data: nodos = [] } = useQuery({
    queryKey: ['nodos'],
    queryFn:  monitoreoApi.listNodos,
  });

  const {
    register, handleSubmit, watch, setValue,
    formState: { errors }, reset,
  } = useForm<FormValues>({
    resolver:      zodResolver(schema),
    defaultValues: { metrica: '', umbralWarning: 80, umbralCritical: 95, notificarWhatsapp: false },
  });

  const metricaSel = watch('metrica');

  // Auto-rellenar umbrales al cambiar la métrica
  const handleMetricaChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setValue('metrica', val);
    const def = DEFAULTS[val];
    if (def) {
      setValue('umbralWarning',  def.warning);
      setValue('umbralCritical', def.critical);
    }
  };

  const { mutate: crear, isPending: creando } = useMutation({
    mutationFn: (values: FormValues) => monitoreoApi.createConfigAlerta(values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config-alertas'] });
      toast('Configuración de alerta creada', { type: 'success' });
      setShowForm(false);
      reset();
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const { mutate: eliminar } = useMutation({
    mutationFn: (id: string) => monitoreoApi.deleteConfigAlerta(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config-alertas'] });
      toast('Configuración eliminada', { type: 'success' });
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const unidadMetrica = METRICAS_ALERTA.find((m) => m.value === metricaSel)?.unidad ?? '';

  return (
    <div className="max-w-3xl space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/monitoreo')}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Monitoreo
          </button>
          <div>
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Bell className="w-5 h-5 text-primary" />
              Configuración de alertas
            </h2>
            <p className="text-sm text-muted-foreground">
              Define umbrales para generar alertas automáticas
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg
                     bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Nueva regla
        </button>
      </div>

      {/* Tabla de reglas */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-12 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : configs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Bell className="w-10 h-10 text-muted-foreground opacity-30 mb-3" />
            <p className="text-sm font-medium text-foreground">Sin reglas configuradas</p>
            <p className="text-xs text-muted-foreground mt-1">
              Crea tu primera regla para recibir alertas automáticas.
            </p>
            <button
              onClick={() => setShowForm(true)}
              className="mt-4 flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg
                         bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Nueva regla
            </button>
          </div>
        ) : (
          <>
            <div className="px-5 py-3 border-b border-border text-xs font-medium text-muted-foreground
                            grid grid-cols-12 gap-2">
              <span className="col-span-4">Métrica</span>
              <span className="col-span-3">Nodo</span>
              <span className="col-span-2">Warning</span>
              <span className="col-span-2">Critical</span>
              <span className="col-span-1" />
            </div>
            <div className="divide-y divide-border">
              {configs.map((cfg) => {
                const metrica = METRICAS_ALERTA.find((m) => m.value === cfg.metrica);
                const nodo    = nodos.find((n) => n.id === cfg.nodoId);

                return (
                  <div key={cfg.id}
                       className="px-5 py-3.5 grid grid-cols-12 gap-2 items-center hover:bg-muted/30 transition-colors">
                    <div className="col-span-4">
                      <p className="text-sm font-medium text-foreground">
                        {metrica?.label ?? cfg.metrica}
                      </p>
                      {cfg.descripcion && (
                        <p className="text-xs text-muted-foreground">{cfg.descripcion}</p>
                      )}
                    </div>
                    <div className="col-span-3">
                      <p className="text-xs text-muted-foreground">
                        {nodo?.nombre ?? (cfg.nodoId ? 'Nodo específico' : 'Todos los nodos')}
                      </p>
                    </div>
                    <div className="col-span-2">
                      <span className="text-sm font-mono font-medium text-orange-600">
                        {cfg.umbralWarning}
                        <span className="text-xs text-muted-foreground ml-0.5">
                          {metrica?.unidad}
                        </span>
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-sm font-mono font-bold text-destructive">
                        {cfg.umbralCritical}
                        <span className="text-xs text-muted-foreground ml-0.5">
                          {metrica?.unidad}
                        </span>
                      </span>
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <button
                        onClick={() => eliminar(cfg.id)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive
                                   hover:bg-destructive/10 transition-colors"
                        title="Eliminar regla"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Guía de métricas */}
      <div className="bg-muted/30 border border-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-foreground mb-3">Guía de umbrales recomendados</h3>
        <div className="grid sm:grid-cols-2 gap-2">
          {METRICAS_ALERTA.map((m) => {
            const def = DEFAULTS[m.value];
            if (!def) return null;
            return (
              <div key={m.value} className="flex items-center justify-between text-xs py-1.5 px-3
                                            rounded-lg bg-background border border-border">
                <span className="text-muted-foreground">{m.label}</span>
                <div className="flex items-center gap-2">
                  <span className="text-orange-600 font-medium">{def.warning}{m.unidad}</span>
                  <span className="text-muted-foreground">/</span>
                  <span className="text-destructive font-bold">{def.critical}{m.unidad}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Modal nueva regla */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md
                          max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="text-base font-semibold text-foreground">Nueva regla de alerta</h3>
              <button onClick={() => { setShowForm(false); reset(); }}
                className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit((v) => crear(v))} className="p-6 space-y-4">

              {/* Métrica */}
              <Field label="Métrica *" error={errors.metrica?.message}>
                <select
                  {...register('metrica')}
                  onChange={handleMetricaChange}
                  className={inp(!!errors.metrica)}
                >
                  <option value="">— Selecciona una métrica —</option>
                  {METRICAS_ALERTA.map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </Field>

              {/* Nodo (opcional) */}
              <Field label="Nodo específico (dejar vacío = todos)">
                <select {...register('nodoId')} className={inp()}>
                  <option value="">Todos los nodos</option>
                  {nodos.map((n) => (
                    <option key={n.id} value={n.id}>{n.nombre}</option>
                  ))}
                </select>
              </Field>

              {/* Umbrales */}
              <div className="grid grid-cols-2 gap-4">
                <Field label={`Umbral WARNING ${unidadMetrica}`} error={errors.umbralWarning?.message}>
                  <input
                    type="number"
                    step="any"
                    {...register('umbralWarning')}
                    className={cn(inp(!!errors.umbralWarning), 'text-orange-600 font-medium')}
                  />
                </Field>
                <Field label={`Umbral CRITICAL ${unidadMetrica}`} error={errors.umbralCritical?.message}>
                  <input
                    type="number"
                    step="any"
                    {...register('umbralCritical')}
                    className={cn(inp(!!errors.umbralCritical), 'text-destructive font-bold')}
                  />
                </Field>
              </div>

              <p className="text-xs text-muted-foreground -mt-2">
                Se crea alerta WARNING cuando supera el primer umbral, CRITICAL cuando supera el segundo.
              </p>

              {/* WhatsApp */}
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input type="checkbox" {...register('notificarWhatsapp')} className="rounded mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-foreground">Notificar por WhatsApp</p>
                  <p className="text-xs text-muted-foreground">Envía un mensaje al número configurado.</p>
                </div>
              </label>

              <Field label="Descripción (opcional)">
                <input {...register('descripcion')} placeholder="Ej: Alerta de CPU en router principal" className={inp()} />
              </Field>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowForm(false); reset(); }}
                  className="flex-1 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
                  Cancelar
                </button>
                <button type="submit" disabled={creando}
                  className="flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-lg
                             bg-primary text-primary-foreground font-medium
                             hover:bg-primary/90 disabled:opacity-60 transition-colors">
                  {creando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Crear regla
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">{label}</label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function inp(hasError = false) {
  return cn(
    'w-full px-3 py-2 text-sm rounded-lg border bg-background',
    'placeholder:text-muted-foreground transition-colors',
    'focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent',
    hasError ? 'border-destructive' : 'border-input',
  );
}
