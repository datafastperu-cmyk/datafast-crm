'use client';

import { useEffect }   from 'react';
import { useForm }     from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z }           from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, FileText, Receipt, Hash, BadgeDollarSign,
  TrendingUp, FileCheck,
} from 'lucide-react';

import { configApi, type UpdateEmpresaDto, type FacturacionResumen } from '@/lib/api/configuracion';
import { useToast }  from '@/components/ui/toaster';
import { parseApiError, cn } from '@/lib/utils';

// ─── Monedas LatAm ────────────────────────────────────────────
const MONEDAS = [
  { code: 'PEN', label: 'Sol Peruano',         symbol: 'S/',  pais: 'Perú' },
  { code: 'USD', label: 'Dólar Americano',      symbol: '$',   pais: 'Internacional' },
  { code: 'ARS', label: 'Peso Argentino',       symbol: '$',   pais: 'Argentina' },
  { code: 'BOB', label: 'Boliviano',            symbol: 'Bs.', pais: 'Bolivia' },
  { code: 'BRL', label: 'Real Brasileño',       symbol: 'R$',  pais: 'Brasil' },
  { code: 'CLP', label: 'Peso Chileno',         symbol: '$',   pais: 'Chile' },
  { code: 'COP', label: 'Peso Colombiano',      symbol: '$',   pais: 'Colombia' },
  { code: 'CRC', label: 'Colón Costarricense',  symbol: '₡',   pais: 'Costa Rica' },
  { code: 'DOP', label: 'Peso Dominicano',      symbol: 'RD$', pais: 'R. Dominicana' },
  { code: 'GTQ', label: 'Quetzal Guatemalteco', symbol: 'Q',   pais: 'Guatemala' },
  { code: 'HNL', label: 'Lempira Hondureño',    symbol: 'L',   pais: 'Honduras' },
  { code: 'MXN', label: 'Peso Mexicano',        symbol: '$',   pais: 'México' },
  { code: 'NIO', label: 'Córdoba Nicaragüense', symbol: 'C$',  pais: 'Nicaragua' },
  { code: 'PAB', label: 'Balboa Panameño',      symbol: 'B/.',  pais: 'Panamá' },
  { code: 'PYG', label: 'Guaraní Paraguayo',    symbol: '₲',   pais: 'Paraguay' },
  { code: 'UYU', label: 'Peso Uruguayo',        symbol: '$U',  pais: 'Uruguay' },
  { code: 'VES', label: 'Bolívar Venezolano',   symbol: 'Bs.S',pais: 'Venezuela' },
];

const TIPOS_COMPROBANTE = [
  { value: 'boleta',        label: 'Boleta de Venta',  desc: 'Para clientes personas naturales. Incluye IGV integrado.' },
  { value: 'factura',       label: 'Factura',          desc: 'Para clientes con RUC. Detalla subtotal + IGV por separado.' },
  { value: 'recibo_interno', label: 'Recibo',          desc: 'Comprobante interno sin desglose de impuestos. Ideal para ISPs sin facturación SUNAT.' },
];

const schema = z.object({
  serieBoleta:            z.string().min(2, 'Mínimo 2 caracteres'),
  serieFactura:           z.string().min(2, 'Mínimo 2 caracteres'),
  tipoComprobanteDefault: z.string().min(1),
  igvRate:                z.coerce.number().int().min(0).max(100),
  moneda:                 z.string().length(3),
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

  const { data: resumen, isLoading: loadingResumen } = useQuery({
    queryKey: ['facturacion-resumen'],
    queryFn:  configApi.getFacturacionResumen,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  const {
    register, handleSubmit, reset, watch,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      igvRate: 18,
      serieBoleta: 'B001', serieFactura: 'F001',
      moneda: 'PEN', tipoComprobanteDefault: 'boleta',
    },
  });

  useEffect(() => {
    if (empresa) reset({ ...empresa, igvRate: Math.round((empresa.igvRate ?? 0.18) * 100) } as any);
  }, [empresa, reset]);

  const { mutate: guardar, isPending } = useMutation({
    mutationFn: (values: FormValues) =>
      configApi.updateEmpresa({ ...values, igvRate: values.igvRate / 100 } as UpdateEmpresaDto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['empresa'] });
      toast('Configuración guardada', { type: 'success' });
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const watchSerieBoleta  = watch('serieBoleta');
  const watchSerieFactura = watch('serieFactura');
  const watchMoneda       = watch('moneda');
  const watchTipo         = watch('tipoComprobanteDefault');
  const monedaInfo        = MONEDAS.find(m => m.code === watchMoneda);

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-32 rounded-xl bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground">Facturación y cobranza</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Configura los parámetros de comprobantes, impuestos y ciclo de cobranza.</p>
      </div>

      {/* ── Resumen en vivo ────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard
          icon={<Receipt className="w-4 h-4" />}
          label="Último N° boleta"
          value={loadingResumen ? '…' : formatCorrelativo(resumen?.serieBoleta, resumen?.ultimaBoleta)}
          color="blue"
        />
        <StatCard
          icon={<FileText className="w-4 h-4" />}
          label="Último N° factura"
          value={loadingResumen ? '…' : formatCorrelativo(resumen?.serieFactura, resumen?.ultimaFactura)}
          color="violet"
        />
        <StatCard
          icon={<FileCheck className="w-4 h-4" />}
          label="Comprobantes activos"
          value={loadingResumen ? '…' : String(resumen?.totalEmitidas ?? 0)}
          sub={resumen?.totalVencidas ? `${resumen.totalVencidas} vencidos` : undefined}
          color={resumen?.totalVencidas ? 'amber' : 'green'}
        />
        <StatCard
          icon={<TrendingUp className="w-4 h-4" />}
          label="Deuda pendiente"
          value={loadingResumen ? '…' : fmtMonto(resumen?.montoDeudaPendiente ?? 0, monedaInfo?.symbol ?? 'S/')}
          color={resumen?.montoDeudaPendiente ? 'red' : 'green'}
        />
      </div>

      <form onSubmit={handleSubmit((v) => guardar(v))} className="space-y-5">

        {/* ── Tipo de comprobante ──────────────────────────────── */}
        <Card title="Tipo de comprobante de pago" icon={<Receipt className="w-4 h-4" />}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {TIPOS_COMPROBANTE.map(({ value, label, desc }) => {
              const active = watchTipo === value;
              return (
                <label key={value} className={cn(
                  'relative flex flex-col gap-1 p-4 rounded-xl border-2 cursor-pointer transition-all',
                  active
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-muted-foreground/40',
                )}>
                  <input
                    type="radio"
                    value={value}
                    {...register('tipoComprobanteDefault')}
                    className="sr-only"
                  />
                  {active && (
                    <span className="absolute top-3 right-3 w-2.5 h-2.5 rounded-full bg-primary" />
                  )}
                  <span className="text-sm font-semibold text-foreground">{label}</span>
                  <span className="text-xs text-muted-foreground leading-snug">{desc}</span>
                </label>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-4 mt-4">
            <Field label="Serie boleta" error={errors.serieBoleta?.message}>
              <div className="relative">
                <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <input
                  {...register('serieBoleta')}
                  placeholder="B001"
                  className={cn(inp(!!errors.serieBoleta), 'font-mono pl-8')}
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Próximo: <span className="font-mono text-primary">{watchSerieBoleta || 'B001'}-{String((resumen?.ultimaBoleta ?? 0) + 1).padStart(5, '0')}</span>
              </p>
            </Field>
            <Field label="Serie factura" error={errors.serieFactura?.message}>
              <div className="relative">
                <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <input
                  {...register('serieFactura')}
                  placeholder="F001"
                  className={cn(inp(!!errors.serieFactura), 'font-mono pl-8')}
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Próximo: <span className="font-mono text-primary">{watchSerieFactura || 'F001'}-{String((resumen?.ultimaFactura ?? 0) + 1).padStart(5, '0')}</span>
              </p>
            </Field>
          </div>
        </Card>

        {/* ── Moneda e Impuestos ───────────────────────────────── */}
        <Card title="Moneda e impuestos" icon={<BadgeDollarSign className="w-4 h-4" />}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Moneda del sistema" error={undefined}>
              <select {...register('moneda')} className={inp()}>
                {MONEDAS.map(m => (
                  <option key={m.code} value={m.code}>
                    {m.code} — {m.label} ({m.pais})
                  </option>
                ))}
              </select>
              {monedaInfo && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Símbolo: <span className="font-mono font-semibold">{monedaInfo.symbol}</span> · Los comprobantes usarán esta moneda
                </p>
              )}
            </Field>
            <Field label="Tasa IGV / IVA" error={errors.igvRate?.message}>
              <div className="relative w-32">
                <input
                  type="number" step="1" min="0" max="100"
                  {...register('igvRate')}
                  className={cn(inp(!!errors.igvRate), 'pr-8')}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">%</span>
              </div>
            </Field>
          </div>
        </Card>

        <div className="flex justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={() => reset()}
            className="px-4 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors"
          >
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
  );
}

// ─── Sub-components ───────────────────────────────────────────

function StatCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: string;
  sub?: string; color: 'blue' | 'violet' | 'green' | 'amber' | 'red';
}) {
  const colors = {
    blue:   'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400',
    violet: 'bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400',
    green:  'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400',
    amber:  'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400',
    red:    'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400',
  };
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-2">
      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', colors[color])}>
        {icon}
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-base font-semibold text-foreground font-mono">{value}</p>
        {sub && <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">{sub}</p>}
      </div>
    </div>
  );
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border bg-muted/30">
        <span className="text-muted-foreground">{icon}</span>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
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

function formatCorrelativo(serie?: string, ultimo?: number): string {
  if (!serie || ultimo === undefined) return '—';
  if (ultimo === 0) return 'Sin emitir';
  return `${serie}-${String(ultimo).padStart(5, '0')}`;
}

function fmtMonto(monto: number, symbol: string): string {
  if (monto === 0) return `${symbol} 0.00`;
  return `${symbol} ${monto.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
