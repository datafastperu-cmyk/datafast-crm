'use client';

import { useEffect }   from 'react';
import { useForm }     from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z }           from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 }     from 'lucide-react';

import { configApi, type UpdateEmpresaDto } from '@/lib/api/configuracion';
import { useToast }  from '@/components/ui/toaster';
import { parseApiError, cn } from '@/lib/utils';

const schema = z.object({
  serieBoleta:     z.string().min(2, 'Mínimo 2 caracteres'),
  serieFactura:    z.string().min(2, 'Mínimo 2 caracteres'),
  igvRate:         z.coerce.number().min(0).max(1),
  diaFacturacion:  z.coerce.number().int().min(1).max(28),
  diasGraciaCorte: z.coerce.number().int().min(0).max(30),
});
type FormValues = z.infer<typeof schema>;

export default function FacturacionConfigPage() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  const { data: empresa, isLoading } = useQuery({
    queryKey: ['empresa'],
    queryFn:  configApi.getEmpresa,
    staleTime: 5 * 60_000,
  });

  const {
    register, handleSubmit, reset,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      igvRate: 0.18, diasGraciaCorte: 5, diaFacturacion: 1,
      serieBoleta: 'B001', serieFactura: 'F001',
    },
  });

  useEffect(() => {
    if (empresa) reset(empresa as any);
  }, [empresa, reset]);

  const { mutate: guardar, isPending } = useMutation({
    mutationFn: (values: FormValues) => configApi.updateEmpresa(values as UpdateEmpresaDto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['empresa'] });
      toast('Configuración guardada', { type: 'success' });
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  if (isLoading) {
    return (
      <div className="p-6 max-w-2xl space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton h-10 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-lg font-semibold text-foreground mb-6">Facturación y cobranza</h2>

      <div className="bg-card border border-border rounded-xl p-6">
        <form onSubmit={handleSubmit((v) => guardar(v))} className="space-y-6">

          <Section title="Series de comprobantes">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Serie boleta" error={errors.serieBoleta?.message}>
                <input {...register('serieBoleta')} placeholder="B001" className={cn(inp(!!errors.serieBoleta), 'font-mono')} />
              </Field>
              <Field label="Serie factura" error={errors.serieFactura?.message}>
                <input {...register('serieFactura')} placeholder="F001" className={cn(inp(!!errors.serieFactura), 'font-mono')} />
              </Field>
            </div>
          </Section>

          <Section title="Impuestos y cobranza">
            <div className="grid grid-cols-3 gap-4">
              <Field label="Tasa IGV (0.18 = 18%)" error={errors.igvRate?.message}>
                <input type="number" step="0.01" min="0" max="1" {...register('igvRate')} className={inp(!!errors.igvRate)} />
              </Field>
              <Field label="Día de facturación (1-28)" error={errors.diaFacturacion?.message}>
                <input type="number" min={1} max={28} {...register('diaFacturacion')} className={inp(!!errors.diaFacturacion)} />
                <p className="text-[11px] text-muted-foreground leading-snug mt-1">
                  Día del mes en que se genera la factura mensual
                </p>
              </Field>
              <Field label="Días de gracia antes del corte" error={errors.diasGraciaCorte?.message}>
                <input type="number" min={0} max={30} {...register('diasGraciaCorte')} className={inp(!!errors.diasGraciaCorte)} />
                <p className="text-[11px] text-muted-foreground leading-snug mt-1">
                  Días de tolerancia tras el vencimiento antes de suspender
                </p>
              </Field>
            </div>
          </Section>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => reset()}
              className="px-4 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
              Restablecer
            </button>
            <button
              type="submit"
              disabled={isPending || !isDirty}
              className="flex items-center gap-2 px-5 py-2 text-sm rounded-lg
                         bg-primary text-primary-foreground font-medium
                         hover:bg-primary/90 disabled:opacity-60 transition-colors"
            >
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Guardar cambios
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
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

function inp(hasError = false) {
  return cn(
    'w-full px-3 py-2 text-sm rounded-lg border bg-background placeholder:text-muted-foreground transition-colors',
    'focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent',
    hasError ? 'border-destructive' : 'border-input',
  );
}
