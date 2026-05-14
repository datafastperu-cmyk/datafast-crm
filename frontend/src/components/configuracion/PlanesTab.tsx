'use client';

import { useState }       from 'react';
import { useForm }        from 'react-hook-form';
import { zodResolver }    from '@hookform/resolvers/zod';
import { z }              from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, ToggleRight, ToggleLeft, Loader2, Wifi } from 'lucide-react';

import { planesApi }     from '@/lib/api/contratos';
import api               from '@/lib/api';
import { useToast }      from '@/components/ui/toaster';
import { parseApiError, formatPEN, cn } from '@/lib/utils';
import type { Plan }     from '@/types';

const schema = z.object({
  nombre:          z.string().min(2, 'Mínimo 2 caracteres'),
  descripcion:     z.string().optional(),
  tipo:            z.enum(['residencial','empresarial','dedicado','prepago']),
  velocidadBajada: z.coerce.number().int().min(1, 'Mínimo 1 Mbps'),
  velocidadSubida: z.coerce.number().int().min(1, 'Mínimo 1 Mbps'),
  burstBajada:     z.coerce.number().optional(),
  burstSubida:     z.coerce.number().optional(),
  precio:          z.coerce.number().min(1, 'Precio requerido'),
  precioInstalacion: z.coerce.number().min(0),
  aplicaIgv:       z.boolean(),
  tipoQueue:       z.enum(['simple_queue','queue_tree','pcq','sin_limite']),
  pppProfile:      z.string().optional(),
  colorUi:         z.string().default('#3b82f6'),
  visibleEnPortal: z.boolean().default(true),
  ordenDisplay:    z.coerce.number().int().default(0),
});
type FormValues = z.infer<typeof schema>;

const TIPO_QUEUE_LABELS: Record<string, string> = {
  simple_queue: 'Simple Queue (por cliente)',
  queue_tree:   'Queue Tree (por cliente)',
  pcq:          'PCQ (compartido)',
  sin_limite:   'Sin límite de velocidad',
};

export function PlanesTab() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();
  const [editando, setEditando] = useState<Plan | null>(null);
  const [showForm, setShowForm] = useState(false);

  const { data: planes = [], isLoading } = useQuery<Plan[]>({
    queryKey: ['planes'],
    queryFn:  planesApi.list,
  });

  const {
    register, handleSubmit, reset, setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver:      zodResolver(schema),
    defaultValues: {
      tipo: 'residencial', tipoQueue: 'simple_queue',
      aplicaIgv: true, visibleEnPortal: true,
      precio: 0, precioInstalacion: 0, ordenDisplay: 0,
      colorUi: '#3b82f6',
    },
  });

  const abrirNuevo = () => {
    setEditando(null);
    reset({
      tipo: 'residencial', tipoQueue: 'simple_queue',
      aplicaIgv: true, visibleEnPortal: true,
      precio: 0, precioInstalacion: 0, ordenDisplay: 0, colorUi: '#3b82f6',
    });
    setShowForm(true);
  };

  const abrirEditar = (plan: Plan) => {
    setEditando(plan);
    reset(plan as any);
    setShowForm(true);
  };

  const { mutate: guardar, isPending } = useMutation({
    mutationFn: async (values: FormValues) => {
      if (editando) {
        return api.put(`/planes/${editando.id}`, values);
      }
      return api.post('/planes', values);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['planes'] });
      toast(editando ? 'Plan actualizado' : 'Plan creado', { type: 'success' });
      setShowForm(false); setEditando(null); reset();
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const { mutate: togglePlan } = useMutation({
    mutationFn: ({ id, activo }: { id: string; activo: boolean }) =>
      api.patch(`/planes/${id}/estado`, { activo }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['planes'] }),
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  return (
    <div className="space-y-5">

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {planes.length} plan{planes.length !== 1 ? 'es' : ''} configurado{planes.length !== 1 ? 's' : ''}
        </p>
        <button
          onClick={abrirNuevo}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg
                     bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Nuevo plan
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-20 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : planes.length === 0 ? (
        <div className="text-center py-12">
          <Wifi className="w-10 h-10 text-muted-foreground opacity-30 mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">Sin planes configurados</p>
          <p className="text-xs text-muted-foreground mt-1">Crea el primer plan de servicio.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {planes.map((p) => (
            <div key={p.id}
                 className="flex items-center gap-4 p-4 rounded-xl border border-border hover:bg-muted/30 transition-colors">
              {/* Color dot */}
              <div
                className="w-4 h-4 rounded-full flex-shrink-0"
                style={{ backgroundColor: p.colorUi || '#3b82f6' }}
              />

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-foreground">{p.nombre}</p>
                  <span className="text-[10px] font-medium px-1.5 py-px rounded-full bg-muted text-muted-foreground capitalize">
                    {p.tipo}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {TIPO_QUEUE_LABELS[p.tipoQueue] || p.tipoQueue}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  ↓{p.velocidadBajada} / ↑{p.velocidadSubida} Mbps
                  {p.burstBajada && ` · Burst: ↓${p.burstBajada}/↑${p.burstSubida} Mbps`}
                </p>
              </div>

              {/* Precio */}
              <div className="text-right flex-shrink-0">
                <p className="text-base font-bold text-foreground">{formatPEN(p.precio)}</p>
                <p className="text-[10px] text-muted-foreground">
                  /mes {p.aplicaIgv ? '+ IGV' : ''}
                </p>
              </div>

              {/* Acciones */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button onClick={() => abrirEditar(p)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => togglePlan({ id: p.id, activo: !p.activo })}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 text-xs rounded-lg transition-colors font-medium',
                    p.activo
                      ? 'text-green-700 bg-green-100 hover:bg-green-200 dark:bg-green-950/30 dark:text-green-400'
                      : 'text-muted-foreground bg-muted hover:bg-muted/70',
                  )}>
                  {p.activo ? <ToggleRight className="w-3 h-3" /> : <ToggleLeft className="w-3 h-3" />}
                  {p.activo ? 'Activo' : 'Inactivo'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal crear/editar plan */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="text-base font-semibold text-foreground">
                {editando ? `Editar: ${editando.nombre}` : 'Nuevo plan de servicio'}
              </h3>
              <button onClick={() => { setShowForm(false); setEditando(null); reset(); }}
                className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>

            <form onSubmit={handleSubmit((v) => guardar(v))} className="p-6 space-y-4">

              <div className="grid grid-cols-2 gap-4">
                <Field label="Nombre del plan *" error={errors.nombre?.message} span={2}>
                  <input {...register('nombre')} placeholder="Plan 30 Mbps" className={inp(!!errors.nombre)} />
                </Field>

                <Field label="Tipo">
                  <select {...register('tipo')} className={inp()}>
                    <option value="residencial">Residencial</option>
                    <option value="empresarial">Empresarial</option>
                    <option value="dedicado">Dedicado</option>
                    <option value="prepago">Prepago</option>
                  </select>
                </Field>

                <Field label="Color UI">
                  <div className="flex items-center gap-2">
                    <input type="color" {...register('colorUi')}
                      className="w-10 h-9 rounded-lg border border-input cursor-pointer" />
                    <input {...register('colorUi')} placeholder="#3b82f6"
                      className={cn(inp(), 'flex-1 font-mono text-xs')} />
                  </div>
                </Field>

                <Field label="Velocidad bajada (Mbps) *" error={errors.velocidadBajada?.message}>
                  <input type="number" min={1} {...register('velocidadBajada')} className={inp(!!errors.velocidadBajada)} />
                </Field>
                <Field label="Velocidad subida (Mbps) *" error={errors.velocidadSubida?.message}>
                  <input type="number" min={1} {...register('velocidadSubida')} className={inp(!!errors.velocidadSubida)} />
                </Field>

                <Field label="Burst bajada (Mbps)">
                  <input type="number" min={0} {...register('burstBajada')} placeholder="Opcional" className={inp()} />
                </Field>
                <Field label="Burst subida (Mbps)">
                  <input type="number" min={0} {...register('burstSubida')} placeholder="Opcional" className={inp()} />
                </Field>

                <Field label="Precio mensual (S/) *" error={errors.precio?.message}>
                  <input type="number" step="0.01" min={0} {...register('precio')} className={inp(!!errors.precio)} />
                </Field>
                <Field label="Precio instalación (S/)">
                  <input type="number" step="0.01" min={0} {...register('precioInstalacion')} className={inp()} />
                </Field>

                <Field label="Tipo de Queue" span={2}>
                  <select {...register('tipoQueue')} className={inp()}>
                    {Object.entries(TIPO_QUEUE_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Perfil PPP (nombre en Mikrotik)">
                  <input {...register('pppProfile')} placeholder="default" className={cn(inp(), 'font-mono text-xs')} />
                </Field>
                <Field label="Orden de visualización">
                  <input type="number" min={0} {...register('ordenDisplay')} className={inp()} />
                </Field>
              </div>

              <div className="flex flex-col gap-2 pt-1">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" {...register('aplicaIgv')} className="rounded" />
                  Precio incluye IGV (18%)
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" {...register('visibleEnPortal')} className="rounded" />
                  Visible en el portal de clientes
                </label>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowForm(false); setEditando(null); reset(); }}
                  className="flex-1 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
                  Cancelar
                </button>
                <button type="submit" disabled={isPending}
                  className="flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-lg
                             bg-primary text-primary-foreground font-medium disabled:opacity-60 transition-colors">
                  {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {editando ? 'Guardar cambios' : 'Crear plan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, error, children, span }: {
  label: string; error?: string; children: React.ReactNode; span?: number;
}) {
  return (
    <div className={cn('space-y-1.5', span === 2 && 'col-span-2')}>
      <label className="text-xs font-medium text-foreground">{label}</label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function inp(hasError = false) {
  return cn(
    'w-full px-3 py-2 text-sm rounded-lg border bg-background placeholder:text-muted-foreground transition-colors',
    'focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent',
    hasError ? 'border-destructive' : 'border-input',
  );
}
