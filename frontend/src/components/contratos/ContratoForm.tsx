'use client';

import { useState, useEffect } from 'react';
import { useRouter }           from 'next/navigation';
import { useForm }             from 'react-hook-form';
import { zodResolver }         from '@hookform/resolvers/zod';
import { z }                   from 'zod';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Loader2, Shuffle, ArrowLeft } from 'lucide-react';

import { contratosApi, planesApi, redesApi, type CreateContratoDto } from '@/lib/api/contratos';
import { clientesApi }  from '@/lib/api/clientes';
import { useToast }     from '@/components/ui/toaster';
import { parseApiError, formatPEN, cn } from '@/lib/utils';
import type { Plan }    from '@/types';

// ─── Schema ──────────────────────────────────────────────────
const schema = z.object({
  clienteId:       z.string().uuid('Selecciona un cliente'),
  planId:          z.string().uuid('Selecciona un plan'),
  tipoServicio:    z.enum(['wisp', 'ftth']).default('wisp'),
  routerId:        z.string().optional(),
  oltId:           z.string().optional(),
  segmentoId:      z.string().optional(),
  fechaInicio:     z.string().min(1, 'Fecha requerida'),
  diaFacturacion:  z.number().int().min(1).max(28).optional(),
  descuentoPct:    z.number().min(0).max(100).optional(),
  usuarioPppoe:    z.string().optional(),
  passwordPppoe:   z.string().optional(),
  notasInternas:   z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

interface Props {
  clienteId?: string;
  onSuccess?: (id: string) => void;
}

function randomStr(len: number, chars: string) {
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function generarCredenciales() {
  const user = `cli_${randomStr(8, 'abcdefghijklmnopqrstuvwxyz0123456789')}`;
  const pass = randomStr(5, 'ABCDEFGHJKLMNPQRSTUVWXYZ') +
               randomStr(5, '23456789') +
               randomStr(2, '!@#$');
  return { user, pass };
}

export function ContratoForm({ clienteId: defClienteId, onSuccess }: Props) {
  const router    = useRouter();
  const { toast } = useToast();
  const [planSel, setPlanSel] = useState<Plan | null>(null);

  const hoy = new Date().toISOString().split('T')[0];
  const { user: initUser, pass: initPass } = generarCredenciales();

  const {
    register, handleSubmit, setValue, watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver:      zodResolver(schema),
    defaultValues: {
      clienteId:       defClienteId ?? '',
      tipoServicio:    'wisp' as const,
      fechaInicio:     hoy,
      diaFacturacion:  1,
      descuentoPct:    0,
      usuarioPppoe:    initUser,
      passwordPppoe:   initPass,
    },
  });

  const planId       = watch('planId');
  const clienteId    = watch('clienteId');
  const tipoServicio = watch('tipoServicio');
  const routerId     = watch('routerId');

  // Cascada nivel 1→2: cambiar tipoServicio limpia router y segmento
  useEffect(() => {
    setValue('routerId',   '', { shouldDirty: true });
    setValue('segmentoId', '', { shouldDirty: true });
  }, [tipoServicio]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cascada nivel 2→3: cambiar router limpia segmento
  useEffect(() => {
    setValue('segmentoId', '', { shouldDirty: true });
  }, [routerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Datos remotos ─────────────────────────────────────────
  const { data: planes = [] } = useQuery({
    queryKey: ['planes'],
    queryFn:  planesApi.list,
  });

  const { data: routers = [] } = useQuery({
    queryKey: ['routers', tipoServicio],
    queryFn:  () => redesApi.listRouters(tipoServicio),
  });

  const { data: olts = [] } = useQuery({
    queryKey: ['olts'],
    queryFn:  redesApi.listOlts,
  });

  const { data: segmentosRaw = [] } = useQuery({
    queryKey: ['segmentos-router', routerId],
    queryFn:  () => redesApi.listSegmentos(routerId!),
    enabled:  !!routerId,
  });
  const segmentos = (segmentosRaw as any[]).filter(
    (s: any) => !s.tipoServicio || s.tipoServicio === tipoServicio,
  );

  // Buscar cliente para mostrar el nombre
  const { data: cliente } = useQuery({
    queryKey: ['cliente-mini', clienteId],
    queryFn:  () => clientesApi.getById(clienteId),
    enabled:  !!clienteId && clienteId.length === 36,
    staleTime: Infinity,
  });

  // Actualizar planSel cuando cambia la selección
  useEffect(() => {
    const p = planes.find((pl: Plan) => pl.id === planId);
    setPlanSel(p ?? null);
  }, [planId, planes]);

  // ── Guardar ───────────────────────────────────────────────
  const { mutate: crear, isPending } = useMutation({
    mutationFn: (values: FormValues) => {
      const dto = {
        ...values,
        routerId:    values.routerId    || undefined,
        oltId:       values.oltId       || undefined,
        segmentoId:  values.segmentoId  || undefined,
      } as CreateContratoDto;
      return contratosApi.create(dto);
    },
    onSuccess: (contrato) => {
      toast('Contrato creado', {
        type: 'success',
        description: contrato.numeroContrato,
      });
      onSuccess ? onSuccess(contrato.id) : router.push(`/contratos/${contrato.id}`);
    },
    onError: (err) => toast(parseApiError(err), { type: 'error' }),
  });

  const regenCreds = () => {
    const { user, pass } = generarCredenciales();
    setValue('usuarioPppoe', user,  { shouldDirty: true });
    setValue('passwordPppoe', pass, { shouldDirty: true });
  };

  return (
    <form onSubmit={handleSubmit((v) => crear(v))} className="space-y-5">

      <button
        type="button" onClick={() => router.back()}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4" /> Volver
      </button>

      {/* ── SECCIÓN 1: Abonado y plan ─────────────────────── */}
      <Section title="Abonado y Plan">

        {/* Abonado */}
        <Field label="Abonado *" error={errors.clienteId?.message}>
          {defClienteId ? (
            <div className="px-3 py-2 rounded-lg border border-input bg-muted text-sm text-foreground">
              {cliente?.nombreCompleto ?? defClienteId}
            </div>
          ) : (
            <input
              {...register('clienteId')}
              placeholder="UUID del abonado (pega desde el listado)"
              className={input(!!errors.clienteId)}
            />
          )}
        </Field>

        {/* Plan */}
        <Field label="Plan de servicio *" error={errors.planId?.message}>
          <select {...register('planId')} className={input(!!errors.planId)}>
            <option value="">— Selecciona un plan —</option>
            {planes.map((p: Plan) => (
              <option key={p.id} value={p.id}>
                {p.nombre} · {p.velocidadBajada}/{p.velocidadSubida} Mbps · {formatPEN(p.precio)}/mes
              </option>
            ))}
          </select>
        </Field>

        {/* Preview del plan seleccionado */}
        {planSel && (
          <div className="flex gap-4 p-3 bg-primary/5 border border-primary/20 rounded-lg text-xs">
            <div>
              <p className="text-muted-foreground">Bajada</p>
              <p className="font-bold text-foreground">{planSel.velocidadBajada} Mbps</p>
            </div>
            <div>
              <p className="text-muted-foreground">Subida</p>
              <p className="font-bold text-foreground">{planSel.velocidadSubida} Mbps</p>
            </div>
            <div>
              <p className="text-muted-foreground">Precio</p>
              <p className="font-bold text-foreground">{formatPEN(planSel.precio)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Queue</p>
              <p className="font-bold text-foreground uppercase">{planSel.tipoQueue}</p>
            </div>
          </div>
        )}
      </Section>

      {/* ── SECCIÓN 2: Fechas y facturación ──────────────── */}
      <Section title="Facturación">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Fecha de inicio *" error={errors.fechaInicio?.message}>
            <input type="date" {...register('fechaInicio')} className={input(!!errors.fechaInicio)} />
          </Field>
          <Field label="Día de facturación (1-28)">
            <input
              type="number"
              min={1} max={28}
              {...register('diaFacturacion', { valueAsNumber: true })}
              className={input()}
            />
          </Field>
          <Field label="Descuento (%)">
            <input
              type="number"
              min={0} max={100}
              {...register('descuentoPct', { valueAsNumber: true })}
              className={input()}
            />
          </Field>
        </div>
      </Section>

      {/* ── SECCIÓN 3: Red y aprovisionamiento ───────────── */}
      <Section title="Configuración de red">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Tipo de servicio *">
            <select {...register('tipoServicio')} className={input()}>
              <option value="wisp">WISP (inalámbrico)</option>
              <option value="ftth">FTTH (fibra óptica)</option>
            </select>
          </Field>
          <Field label="Router MikroTik">
            <select {...register('routerId')} className={input()}>
              <option value="">— Sin asignar —</option>
              {routers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nombre} ({r.ipGestion})
                </option>
              ))}
            </select>
          </Field>
          <Field label="OLT (para FTTH)">
            <select {...register('oltId')} className={input()}>
              <option value="">— Sin asignar —</option>
              {olts.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nombre}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Segmento IPv4 (pool de IPs)">
            <select
              {...register('segmentoId')}
              className={input()}
              disabled={!routerId}
            >
              <option value="">
                {routerId ? '— Asignar IP manualmente —' : '— Selecciona un router primero —'}
              </option>
              {segmentos.map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.redCidr} ({s.nombre ?? ''}) · {s.ipsDisponibles} libres
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      {/* ── SECCIÓN 4: Credenciales PPPoE ────────────────── */}
      <Section title="Credenciales PPPoE">
        <p className="text-xs text-muted-foreground -mt-2">
          Se generan automáticamente. Puedes regenerarlas o modificarlas.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Usuario PPPoE">
            <input
              {...register('usuarioPppoe')}
              placeholder="cli_abc12345"
              className={cn(input(), 'font-mono text-xs')}
            />
          </Field>
          <Field label="Contraseña PPPoE">
            <div className="flex gap-2">
              <input
                {...register('passwordPppoe')}
                placeholder="Contraseña"
                className={cn(input(), 'font-mono text-xs flex-1')}
              />
              <button
                type="button"
                onClick={regenCreds}
                className="flex-shrink-0 px-3 rounded-lg border border-input bg-muted
                           text-sm hover:bg-muted/70 transition-colors"
                title="Regenerar credenciales"
              >
                <Shuffle className="w-4 h-4" />
              </button>
            </div>
          </Field>
        </div>
      </Section>

      {/* ── SECCIÓN 5: Notas ─────────────────────────────── */}
      <Section title="Notas internas">
        <textarea
          {...register('notasInternas')}
          rows={3}
          placeholder="Observaciones de instalación, referencias, etc."
          className={cn(input(), 'resize-none')}
        />
      </Section>

      {/* Acciones */}
      <div className="flex justify-end gap-3">
        <button
          type="button" onClick={() => router.back()}
          className="px-4 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="flex items-center gap-2 px-5 py-2 text-sm rounded-lg
                     bg-primary text-primary-foreground font-medium
                     hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          Crear contrato
        </button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 sm:p-5 space-y-4">
      <h3 className="text-sm font-semibold text-foreground pb-2 border-b border-border">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, error, children }: {
  label: string; error?: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">{label}</label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function input(hasError = false) {
  return cn(
    'w-full px-3 py-2 text-sm rounded-lg border bg-background text-foreground',
    'placeholder:text-muted-foreground transition-colors',
    'focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent',
    hasError ? 'border-destructive' : 'border-input',
  );
}
