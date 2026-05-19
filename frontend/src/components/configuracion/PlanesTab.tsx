'use client';

import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Pencil, Trash2, ToggleRight, ToggleLeft,
  Loader2, Wifi, X, AlertTriangle,
} from 'lucide-react';
import { planesApi } from '@/lib/api/contratos';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toaster';
import { parseApiError, formatPEN, cn } from '@/lib/utils';
import type { Plan } from '@/types';

// ─── Schema ───────────────────────────────────────────────────────────────────

const schema = z.object({
  nombre:               z.string().min(2, 'Mínimo 2 caracteres'),
  descripcion:          z.string().optional(),
  precio:               z.coerce.number().min(0, 'Precio requerido'),
  impuesto:             z.coerce.number().min(0).max(100).default(0),
  noCrearReglas:        z.boolean().default(false),
  velocidadBajada:      z.coerce.number().int().min(0).default(0),
  velocidadSubida:      z.coerce.number().int().min(0).default(0),
  velocidadGarantizada: z.coerce.number().int().min(0).max(100).default(10),
  burstKbps:            z.coerce.number().int().min(0).default(0),
  burstUmbral:          z.coerce.number().int().min(0).max(100).default(0),
  burstTiempo:          z.coerce.number().int().min(0).default(0),
  prioridad:            z.coerce.number().int().min(1).max(8).default(8),
  addresslist:          z.string().optional(),
  crearCuentaIptv:      z.boolean().default(false),
  sesionesIptv:         z.coerce.number().int().min(1).max(5).default(1),
});
type FormValues = z.infer<typeof schema>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRIORIDADES = [
  { value: 1, label: 'Muy Alta (1)' },
  { value: 2, label: 'Alta (2)' },
  { value: 3, label: 'Media Alta (3)' },
  { value: 4, label: 'Media (4)' },
  { value: 5, label: 'Normal (5)' },
  { value: 6, label: 'Normal Baja (6)' },
  { value: 7, label: 'Baja (7)' },
  { value: 8, label: 'Baja (8)' },
];

const DEFAULTS: FormValues = {
  nombre: '', descripcion: '', precio: 0, impuesto: 0,
  noCrearReglas: false, velocidadBajada: 0, velocidadSubida: 0,
  velocidadGarantizada: 10, burstKbps: 0, burstUmbral: 0,
  burstTiempo: 0, prioridad: 8, addresslist: '',
  crearCuentaIptv: false, sesionesIptv: 1,
};

function planToForm(p: Plan): FormValues {
  return {
    nombre:               p.nombre,
    descripcion:          p.descripcion ?? '',
    precio:               Number(p.precio),
    impuesto:             p.aplicaIgv ? 18 : 0,
    noCrearReglas:        p.tipoQueue === 'sin_limite',
    velocidadBajada:      p.velocidadBajada,
    velocidadSubida:      p.velocidadSubida,
    velocidadGarantizada: p.velocidadGarantizada ?? 10,
    burstKbps:            p.burstBajada ?? 0,
    burstUmbral:          p.burstUmbral ?? 0,
    burstTiempo:          p.burstTiempo ?? 0,
    prioridad:            p.prioridad ?? 8,
    addresslist:          p.addresslist ?? '',
    crearCuentaIptv:      p.cuentaIptv ?? false,
    sesionesIptv:         p.sesionesIptv ?? 1,
  };
}

function formToPayload(v: FormValues) {
  return {
    nombre:               v.nombre,
    descripcion:          v.descripcion,
    precio:               v.precio,
    aplicaIgv:            v.impuesto > 0,
    tipoQueue:            v.noCrearReglas ? 'sin_limite' : 'simple_queue',
    velocidadBajada:      v.velocidadBajada,
    velocidadSubida:      v.velocidadSubida,
    velocidadGarantizada: v.velocidadGarantizada,
    burstBajada:          v.burstKbps,
    burstSubida:          v.burstKbps,
    burstUmbral:          v.burstUmbral,
    burstTiempo:          v.burstTiempo,
    prioridad:            v.prioridad,
    addresslist:          v.addresslist,
    cuentaIptv:           v.crearCuentaIptv,
    sesionesIptv:         v.crearCuentaIptv ? v.sesionesIptv : null,
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SpeedInput({
  value, onChange, suffix, step = 1024, hint,
}: {
  value: number; onChange: (v: number) => void;
  suffix: string; step?: number; hint?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex">
        <button
          type="button"
          onClick={() => onChange(Math.max(0, value + step))}
          className="px-2.5 py-2 border border-r-0 border-input rounded-l-lg bg-muted text-muted-foreground hover:bg-muted/80 text-sm font-bold transition-colors"
        >
          +
        </button>
        <input
          type="number"
          min={0}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="flex-1 px-3 py-2 text-sm border border-input bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-center min-w-0"
        />
        <span className="px-2.5 py-2 border border-l-0 border-input rounded-r-lg bg-muted text-muted-foreground text-xs font-semibold whitespace-nowrap">
          {suffix}
        </span>
      </div>
      {hint && <p className="text-[11px] text-primary">{hint}</p>}
    </div>
  );
}

function PctInput({
  value, onChange, hint,
}: {
  value: number; onChange: (v: number) => void; hint?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex">
        <input
          type="number"
          min={0}
          max={100}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="flex-1 px-3 py-2 text-sm border border-r-0 border-input rounded-l-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary min-w-0"
        />
        <span className="px-2.5 py-2 border border-l-0 border-input rounded-r-lg bg-muted text-muted-foreground text-xs font-semibold">
          %
        </span>
      </div>
      {hint && <p className="text-[11px] text-primary">{hint}</p>}
    </div>
  );
}

// ─── Delete confirm dialog ────────────────────────────────────────────────────

function DeleteDialog({
  plan, onConfirm, onCancel, isPending,
}: {
  plan: Plan; onConfirm: () => void; onCancel: () => void; isPending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-destructive" />
          </div>
          <div>
            <p className="font-semibold text-foreground">Eliminar plan</p>
            <p className="text-sm text-muted-foreground mt-1">
              ¿Eliminar <span className="font-medium text-foreground">"{plan.nombre}"</span>? Esta acción no se puede deshacer.
            </p>
          </div>
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={onCancel}
            className="flex-1 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
            Cancelar
          </button>
          <button onClick={onConfirm} disabled={isPending}
            className="flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-lg bg-destructive text-white font-medium disabled:opacity-60 transition-colors">
            {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Eliminar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PlanesTab() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  const [editando,      setEditando]      = useState<Plan | null>(null);
  const [showForm,      setShowForm]      = useState(false);
  const [deletePlan,    setDeletePlan]    = useState<Plan | null>(null);

  const { data: planes = [], isLoading } = useQuery<Plan[]>({
    queryKey: ['planes-admin'],
    queryFn:  planesApi.list,
  });

  const { register, handleSubmit, reset, watch, setValue, control, formState: { errors } } =
    useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: DEFAULTS });

  const noCrearReglas    = watch('noCrearReglas');
  const crearCuentaIptv  = watch('crearCuentaIptv');
  const descarga         = watch('velocidadBajada');
  const subida        = watch('velocidadSubida');
  const limitAt       = watch('velocidadGarantizada');
  const burstKbps     = watch('burstKbps');

  const abrirNuevo = () => { setEditando(null); reset(DEFAULTS); setShowForm(true); };
  const abrirEditar = (p: Plan) => { setEditando(p); reset(planToForm(p)); setShowForm(true); };
  const cerrar = () => { setShowForm(false); setEditando(null); reset(DEFAULTS); };

  const { mutate: guardar, isPending: guardando } = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = formToPayload(values);
      return editando
        ? api.put(`/planes/${editando.id}`, payload)
        : api.post('/planes', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['planes-admin'] });
      queryClient.invalidateQueries({ queryKey: ['planes'] });
      toast(editando ? 'Plan actualizado' : 'Plan creado', { type: 'success' });
      cerrar();
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const { mutate: toggleActivo } = useMutation({
    mutationFn: ({ id, activo }: { id: string; activo: boolean }) =>
      api.patch(`/planes/${id}/estado`, { activo }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['planes-admin'] }),
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const { mutate: eliminar, isPending: eliminando } = useMutation({
    mutationFn: (id: string) => api.delete(`/planes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['planes-admin'] });
      queryClient.invalidateQueries({ queryKey: ['planes'] });
      toast('Plan eliminado', { type: 'success' });
      setDeletePlan(null);
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const inp = (err = false) => cn(
    'w-full px-3 py-2 text-sm rounded-lg border bg-background text-foreground placeholder:text-muted-foreground',
    'focus:outline-none focus:ring-1 focus:ring-primary transition-colors',
    err ? 'border-destructive' : 'border-input',
  );

  return (
    <div className="space-y-4">

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {planes.length} plan{planes.length !== 1 ? 'es' : ''}
        </p>
        <button onClick={abrirNuevo}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors">
          <Plus className="w-3.5 h-3.5" /> Nuevo plan
        </button>
      </div>

      {/* Plan list */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : planes.length === 0 ? (
        <div className="text-center py-12">
          <Wifi className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">Sin planes configurados</p>
          <p className="text-xs text-muted-foreground mt-1">Crea el primer plan.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {planes.map((p) => (
            <div key={p.id}
              className="flex items-center gap-4 px-4 py-3 rounded-xl border border-border hover:bg-muted/30 transition-colors">
              <div className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ backgroundColor: p.colorUi || '#3b82f6' }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-foreground">{p.nombre}</span>
                  <span className="text-[10px] px-1.5 py-px rounded-full bg-muted text-muted-foreground capitalize">{p.tipo}</span>
                  {p.tipoQueue === 'sin_limite' && (
                    <span className="text-[10px] px-1.5 py-px rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      Sin reglas
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  ↓{p.velocidadBajada.toLocaleString()} / ↑{p.velocidadSubida.toLocaleString()} Kbps
                  {p.burstBajada ? ` · Burst: ${p.burstBajada.toLocaleString()} Kbps` : ''}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-bold text-foreground">{formatPEN(p.precio)}</p>
                <p className="text-[10px] text-muted-foreground">/mes {p.aplicaIgv ? '+ IGV' : ''}</p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => toggleActivo({ id: p.id, activo: !p.activo })}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 text-xs rounded-lg font-medium transition-colors',
                    p.activo
                      ? 'text-emerald-700 bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400'
                      : 'text-muted-foreground bg-muted hover:bg-muted/70',
                  )}>
                  {p.activo ? <ToggleRight className="w-3 h-3" /> : <ToggleLeft className="w-3 h-3" />}
                  {p.activo ? 'Activo' : 'Inactivo'}
                </button>
                <button onClick={() => abrirEditar(p)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setDeletePlan(p)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirm */}
      {deletePlan && (
        <DeleteDialog
          plan={deletePlan}
          isPending={eliminando}
          onConfirm={() => eliminar(deletePlan.id)}
          onCancel={() => setDeletePlan(null)}
        />
      )}

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">

            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="text-base font-semibold text-foreground">
                {editando ? `Editar: ${editando.nombre}` : 'Nuevo Perfil'}
              </h3>
              <button onClick={cerrar} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit(v => guardar(v))} className="p-6 space-y-4">

              {/* Nombre */}
              <div className="space-y-1">
                <label className="text-sm text-foreground">Nombre Plan</label>
                <input {...register('nombre')} placeholder="Plan Premium 4Mbps" className={inp(!!errors.nombre)} />
                {errors.nombre && <p className="text-xs text-destructive">{errors.nombre.message}</p>}
              </div>

              {/* Descripción */}
              <div className="space-y-1">
                <label className="text-sm text-foreground">Descripción</label>
                <input {...register('descripcion')} placeholder="Internet banda ancha  4Mbps/2Mbps" className={inp()} />
                <p className="text-[11px] text-amber-600 dark:text-amber-400">* Texto para la Facturación</p>
              </div>

              {/* Precio + Impuesto */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm text-foreground">Precio Plan</label>
                  <div className="flex">
                    <span className="px-3 py-2 border border-r-0 border-input rounded-l-lg bg-muted text-muted-foreground text-sm font-semibold">
                      S/.
                    </span>
                    <input type="number" step="0.01" min={0} {...register('precio')}
                      className={cn(inp(!!errors.precio), 'rounded-l-none')} />
                  </div>
                  {errors.precio && <p className="text-xs text-destructive">{errors.precio.message}</p>}
                </div>
                <div className="space-y-1">
                  <label className="text-sm text-foreground">Impuesto (%)</label>
                  <div className="flex">
                    <input type="number" min={0} max={100} {...register('impuesto')}
                      className={cn(inp(), 'rounded-r-none')} />
                    <span className="px-3 py-2 border border-l-0 border-input rounded-r-lg bg-muted text-muted-foreground text-sm font-semibold">
                      %
                    </span>
                  </div>
                </div>
              </div>

              {/* No crear reglas */}
              <div className="flex items-center gap-3 py-1">
                <label className="text-sm text-foreground">No crear reglas</label>
                <Controller
                  name="noCrearReglas"
                  control={control}
                  render={({ field }) => (
                    <button type="button"
                      onClick={() => field.onChange(!field.value)}
                      className={cn(
                        'relative w-10 h-5 rounded-full transition-colors',
                        field.value ? 'bg-primary' : 'bg-muted-foreground/30',
                      )}>
                      <span className={cn(
                        'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                        field.value ? 'translate-x-5' : 'translate-x-0',
                      )} />
                    </button>
                  )}
                />
                <span className="text-xs text-muted-foreground">
                  {noCrearReglas ? 'Sin límite de velocidad en MikroTik' : 'Aplicar QoS al plan'}
                </span>
              </div>

              {/* Crear cuenta IPTV */}
              <div className="space-y-2">
                <div className="flex items-center gap-3 py-1 flex-wrap">
                  <label className="text-sm text-foreground">Crear cuenta IPTV</label>
                  <Controller
                    name="crearCuentaIptv"
                    control={control}
                    render={({ field }) => (
                      <button type="button"
                        onClick={() => field.onChange(!field.value)}
                        className={cn(
                          'relative w-10 h-5 rounded-full transition-colors',
                          field.value ? 'bg-primary' : 'bg-muted-foreground/30',
                        )}>
                        <span className={cn(
                          'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                          field.value ? 'translate-x-5' : 'translate-x-0',
                        )} />
                      </button>
                    )}
                  />
                  {crearCuentaIptv && (
                    <div className="space-y-1">
                      <p className="text-[11px] text-amber-600 dark:text-amber-400">* Cantidad de sesiones que pueden estar activas por cada cuenta</p>
                      <select {...register('sesionesIptv')} className={inp()}>
                        {[1, 2, 3, 4, 5].map(n => (
                          <option key={n} value={n}>{n} sesión{n > 1 ? 'es' : ''}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-amber-600 dark:text-amber-400">* Se creará cuenta IPTV al contratar</p>
              </div>

              {/* Velocidades (oculto si noCrearReglas) */}
              {!noCrearReglas && (
                <>
                  <hr className="border-border" />

                  {/* Descarga / Subida */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-sm text-foreground">Descarga Kbps</label>
                      <Controller name="velocidadBajada" control={control} render={({ field }) => (
                        <SpeedInput value={field.value} onChange={field.onChange} suffix="Kbps"
                          hint={`${(field.value / 1024).toFixed(1)} Mbps`} />
                      )} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm text-foreground">Subida Kbps</label>
                      <Controller name="velocidadSubida" control={control} render={({ field }) => (
                        <SpeedInput value={field.value} onChange={field.onChange} suffix="Kbps"
                          hint={`${(field.value / 1024).toFixed(1)} Mbps`} />
                      )} />
                    </div>
                  </div>

                  {/* Limit AT / Burst Limit */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-sm text-foreground">Limit AT</label>
                      <Controller name="velocidadGarantizada" control={control} render={({ field }) => (
                        <PctInput value={field.value} onChange={field.onChange}
                          hint={`Velocidad garantizada RX/TX: ${Math.round(subida * field.value / 100)}/${Math.round(descarga * field.value / 100)} Kbps`} />
                      )} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm text-foreground">Burst Limit</label>
                      <Controller name="burstKbps" control={control} render={({ field }) => (
                        <SpeedInput value={field.value} onChange={field.onChange} suffix="Kbps"
                          hint={`RX/TX: ${field.value.toLocaleString()}/${field.value.toLocaleString()} Kbps`} />
                      )} />
                    </div>
                  </div>

                  {/* Burst threshold / Burst Time */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-sm text-foreground">Burst threshold</label>
                      <Controller name="burstUmbral" control={control} render={({ field }) => (
                        <PctInput value={field.value} onChange={field.onChange}
                          hint={`RX/TX: ${Math.round(subida * field.value / 100)}/${Math.round(descarga * field.value / 100)} Kbps`} />
                      )} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm text-foreground">Burst Time</label>
                      <div className="space-y-1">
                        <div className="flex">
                          <input type="number" min={0} {...register('burstTiempo')}
                            className={cn(inp(), 'rounded-r-none')} />
                          <span className="px-2.5 py-2 border border-l-0 border-input rounded-r-lg bg-muted text-muted-foreground text-xs font-semibold">
                            seg
                          </span>
                        </div>
                        <p className="text-[11px] text-primary">Tiempo de Ráfaga</p>
                      </div>
                    </div>
                  </div>

                  {/* Prioridad / Addresslist */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-sm text-foreground">Prioridad</label>
                      <select {...register('prioridad')} className={inp()}>
                        {PRIORIDADES.map(p => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm text-foreground">Addresslist</label>
                      <input {...register('addresslist')} placeholder="habilitados" className={inp()} />
                      <p className="text-[11px] text-amber-600 dark:text-amber-400">
                        *Opcional Lista personalizada ejm: habilitados
                      </p>
                    </div>
                  </div>
                </>
              )}

              {/* Footer */}
              <div className="flex gap-3 pt-2 border-t border-border">
                <button type="button" onClick={cerrar}
                  className="flex-1 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
                  Cerrar
                </button>
                <button type="submit" disabled={guardando}
                  className="flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-lg bg-primary text-primary-foreground font-medium disabled:opacity-60 transition-colors">
                  {guardando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {editando ? 'Guardar cambios' : 'Registrar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
