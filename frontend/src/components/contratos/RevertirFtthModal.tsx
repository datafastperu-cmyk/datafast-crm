'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  X, Loader2, CheckCircle2, AlertCircle, Radio, RotateCcw, SkipForward, ArrowLeft,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { migracionApi, type MigracionResultado, type PasoMigracion } from '@/lib/api/migracion';
import { redesApi } from '@/lib/api/contratos';
import { parseApiError, cn } from '@/lib/utils';

const schema = z.object({
  routerWispId:   z.string().min(1, 'Selecciona el router WISP de destino'),
  segmentoWispId: z.string().min(1, 'Selecciona el segmento WISP'),
  ipManual:       z.string().optional(),
  motivo:         z.string().optional(),
  rollbackEnError: z.boolean().default(true),
});

type FormData = z.infer<typeof schema>;

const INPUT_CLS =
  'w-full px-3 py-2.5 text-sm rounded-lg border border-input bg-background ' +
  'text-foreground placeholder:text-muted-foreground ' +
  'focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors';

function Field({ label, hint, error, children }: {
  label: string; hint?: string; error?: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">{label}</label>
      {children}
      {hint && !error && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

function PasoRow({ paso }: { paso: PasoMigracion }) {
  const icons = {
    ok:        <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />,
    error:     <AlertCircle  className="w-4 h-4 text-destructive  flex-shrink-0" />,
    omitido:   <SkipForward  className="w-4 h-4 text-muted-foreground flex-shrink-0" />,
    revertido: <RotateCcw    className="w-4 h-4 text-amber-500   flex-shrink-0" />,
  };
  const colors = {
    ok:        'border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20',
    error:     'border-destructive/30 bg-destructive/5',
    omitido:   'border-border bg-muted/30',
    revertido: 'border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20',
  };
  return (
    <div className={cn('flex items-start gap-3 p-3 rounded-lg border', colors[paso.estado])}>
      <div className="flex items-center gap-2 mt-0.5">
        <span className="text-xs font-mono text-muted-foreground w-5 text-right">{paso.paso}.</span>
        {icons[paso.estado]}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground leading-tight">{paso.nombre}</p>
        <p className="text-xs text-muted-foreground mt-0.5 break-words">{paso.detalle}</p>
        {paso.duracionMs != null && (
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">{paso.duracionMs} ms</p>
        )}
      </div>
    </div>
  );
}

interface Props {
  contratoId:      string;
  clienteId:       string;
  numeroContrato?: string;
  onClose:         () => void;
  onSuccess?:      () => void;
}

export function RevertirFtthModal({ contratoId, clienteId, numeroContrato, onClose, onSuccess }: Props) {
  const [resultado, setResultado] = useState<MigracionResultado | null>(null);

  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormData>({
    resolver:      zodResolver(schema),
    defaultValues: { rollbackEnError: true },
  });

  const routerWispId = watch('routerWispId');

  const { data: routers = [] } = useQuery({
    queryKey: ['routers-list'],
    queryFn:  () => redesApi.listRouters(),
  });

  const { data: segmentosRaw = [] } = useQuery({
    queryKey: ['segmentos-router', routerWispId],
    queryFn:  () => redesApi.listSegmentos(routerWispId!),
    enabled:  !!routerWispId,
  });
  const segmentosWisp = (segmentosRaw as any[]).filter(
    (s: any) => !s.tipoServicio || s.tipoServicio === 'wisp',
  );

  const { mutate, isPending } = useMutation({
    mutationFn: (data: FormData) => migracionApi.migrarFtthAWisp({
      contratoId,
      clienteId,
      routerWispId:    data.routerWispId,
      segmentoWispId:  data.segmentoWispId,
      ipManual:        data.ipManual || undefined,
      motivo:          data.motivo || 'Reversión manual FTTH→WISP',
      rollbackEnError: data.rollbackEnError,
    }),
    onSuccess: (res) => {
      setResultado(res);
      if (res.exitoso) onSuccess?.();
    },
    onError: (err) => {
      setResultado({
        pasos: [],
        exitoso:      false,
        contratoId,
        mensajeFinal: parseApiError(err),
        rollbackEjecutado: false,
      });
    },
  });

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-label="Revertir FTTH" className="bg-card border border-destructive/30 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <Radio className="w-5 h-5 text-destructive" />
            <div>
              <h2 className="text-base font-semibold text-foreground">Revertir FTTH → WISP</h2>
              {numeroContrato && (
                <p className="text-xs text-muted-foreground">{numeroContrato}</p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {resultado ? (
            <div className="space-y-4">
              <div className={cn(
                'flex items-start gap-3 p-4 rounded-xl border',
                resultado.exitoso
                  ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30'
                  : 'border-destructive/30 bg-destructive/5',
              )}>
                {resultado.exitoso
                  ? <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                  : <AlertCircle  className="w-5 h-5 text-destructive   flex-shrink-0 mt-0.5" />
                }
                <div>
                  <p className="text-sm font-semibold text-foreground">{resultado.mensajeFinal}</p>
                  {resultado.exitoso && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                      El contrato quedó pendiente de activación WISP. Configure el router manualmente si es necesario.
                    </p>
                  )}
                  {resultado.rollbackEjecutado && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                      <RotateCcw className="w-3 h-3" /> Rollback ejecutado — servicio FTTH restaurado
                    </p>
                  )}
                </div>
              </div>
              {resultado.pasos.length > 0 && (
                <div className="space-y-2">
                  {resultado.pasos.map((p) => <PasoRow key={p.paso} paso={p} />)}
                </div>
              )}
            </div>
          ) : (
            <form id="revertir-ftth-form" onSubmit={handleSubmit((d) => mutate(d))} className="space-y-4">

              {/* Advertencia */}
              <div className="flex items-start gap-3 p-4 rounded-xl border border-destructive/30 bg-destructive/5">
                <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">Esta acción revertirá el servicio a WISP</p>
                  <ul className="text-xs text-muted-foreground space-y-0.5 list-disc list-inside">
                    <li>Se desaprovisionará la ONU del OLT (best-effort)</li>
                    <li>Se liberará la IP FTTH y se asignará una IP WISP</li>
                    <li>Se eliminará el acceso en el router FTTH</li>
                    <li>El contrato quedará en <strong>pendiente de activación</strong></li>
                    <li>Requiere reconfiguración manual del router WISP</li>
                  </ul>
                </div>
              </div>

              {/* Router WISP */}
              <Field label="Router WISP de destino *" error={errors.routerWispId?.message}>
                <select {...register('routerWispId')} className={INPUT_CLS}>
                  <option value="">— Seleccionar router WISP —</option>
                  {(routers as any[]).map((r: any) => (
                    <option key={r.id} value={r.id}>{r.nombre}</option>
                  ))}
                </select>
              </Field>

              {/* Segmento WISP */}
              <Field
                label="Pool IPv4 WISP *"
                hint={!routerWispId ? '* Selecciona un router primero' : undefined}
                error={errors.segmentoWispId?.message}
              >
                <select
                  {...register('segmentoWispId')}
                  disabled={!routerWispId}
                  className={cn(INPUT_CLS, !routerWispId && 'opacity-50 cursor-not-allowed')}
                >
                  <option value="">
                    {routerWispId ? 'Seleccionar segmento WISP…' : '— Elige un router primero —'}
                  </option>
                  {segmentosWisp.map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}{s.redCidr ? ` — ${s.redCidr}` : ''}
                      {s.ipsDisponibles != null ? ` (${s.ipsDisponibles} disp.)` : ''}
                    </option>
                  ))}
                </select>
              </Field>

              {/* IP Manual */}
              <Field label="IP Manual WISP" hint="Opcional — se asigna automáticamente si se omite">
                <input {...register('ipManual')} placeholder="192.168.1.50" className={INPUT_CLS} />
              </Field>

              {/* Motivo */}
              <Field label="Motivo de la reversión">
                <input {...register('motivo')} placeholder="Cliente solicita cambio a WISP" className={INPUT_CLS} />
              </Field>

              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" {...register('rollbackEnError')}
                  className="rounded border-input w-3.5 h-3.5" />
                <span className="text-xs text-foreground">Rollback automático si hay error</span>
              </label>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex-shrink-0">
          {resultado ? (
            <div className="flex gap-3">
              <button onClick={onClose}
                className="flex-1 py-2.5 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
                Cerrar
              </button>
              {!resultado.exitoso && (
                <button onClick={() => setResultado(null)}
                  className="flex-1 py-2.5 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
                  Reintentar
                </button>
              )}
            </div>
          ) : (
            <div className="flex gap-3">
              <button type="button" onClick={onClose}
                className="flex-1 py-2.5 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
                Cancelar
              </button>
              <button
                type="submit"
                form="revertir-ftth-form"
                disabled={isPending}
                className="flex-1 py-2.5 text-sm rounded-lg bg-destructive text-destructive-foreground
                           font-medium hover:bg-destructive/90 transition-colors
                           disabled:opacity-60 disabled:cursor-not-allowed
                           flex items-center justify-center gap-2"
              >
                {isPending
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Revirtiendo…</>
                  : <><ArrowLeft className="w-4 h-4" /> Confirmar reversión</>
                }
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
