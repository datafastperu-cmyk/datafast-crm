'use client';

import { useEffect, useState } from 'react';
import { useForm }             from 'react-hook-form';
import { zodResolver }         from '@hookform/resolvers/zod';
import { z }                   from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Upload, Building2 } from 'lucide-react';

import { configApi, type UpdateEmpresaDto } from '@/lib/api/configuracion';
import { useToast }  from '@/components/ui/toaster';
import { parseApiError, cn } from '@/lib/utils';

const schema = z.object({
  razonSocial:       z.string().min(3, 'Mínimo 3 caracteres'),
  ruc:               z.string().length(11, 'El RUC debe tener 11 dígitos'),
  direccion:         z.string().optional(),
  telefono:          z.string().optional(),
  email:             z.string().email('Email inválido').optional().or(z.literal('')),
  websiteUrl:        z.string().url('URL inválida').optional().or(z.literal('')),
  serieBoleta:       z.string().min(3),
  serieFactura:      z.string().min(3),
  igvRate:           z.coerce.number().min(0).max(1),
  diasGraciaCorte:   z.coerce.number().int().min(0).max(30),
  diaFacturacion:    z.coerce.number().int().min(1).max(28),
  notifWhatsappVencimiento: z.boolean(),
  notifWhatsappCorte:       z.boolean(),
});
type FormValues = z.infer<typeof schema>;

export function EmpresaTab() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const { data: empresa, isLoading } = useQuery({
    queryKey: ['empresa'],
    queryFn:  configApi.getEmpresa,
    staleTime: 5 * 60_000,
  });

  const {
    register, handleSubmit, reset,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver:      zodResolver(schema),
    defaultValues: {
      igvRate: 0.18, diasGraciaCorte: 5, diaFacturacion: 1,
      serieBoleta: 'B001', serieFactura: 'F001',
      notifWhatsappVencimiento: true, notifWhatsappCorte: true,
    },
  });

  useEffect(() => {
    if (empresa) {
      reset(empresa as any);
      if (empresa.logoUrl) setLogoPreview(empresa.logoUrl);
    }
  }, [empresa, reset]);

  const { mutate: guardar, isPending } = useMutation({
    mutationFn: (values: FormValues) => configApi.updateEmpresa(values as UpdateEmpresaDto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['empresa'] });
      toast('Configuración guardada', { type: 'success' });
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const { mutate: subirLogo } = useMutation({
    mutationFn: (file: File) => configApi.uploadLogo(file),
    onSuccess: (r) => {
      setLogoPreview(r.logoUrl);
      queryClient.invalidateQueries({ queryKey: ['empresa'] });
      toast('Logo actualizado', { type: 'success' });
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  if (isLoading) return <div className="space-y-4">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-10 rounded-lg animate-pulse" />)}</div>;

  return (
    <form onSubmit={handleSubmit((v) => guardar(v))} className="space-y-6">

      {/* Logo */}
      <div className="flex items-center gap-5">
        <div className={cn(
          'w-20 h-20 rounded-2xl border-2 border-dashed border-border flex items-center justify-center overflow-hidden flex-shrink-0',
          logoPreview ? 'border-transparent' : 'hover:border-primary transition-colors',
        )}>
          {logoPreview
            ? <img src={logoPreview} alt="Logo" className="w-full h-full object-contain" />
            : <Building2 className="w-8 h-8 text-muted-foreground" />}
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">Logo de la empresa</p>
          <p className="text-xs text-muted-foreground mb-2">PNG o SVG · máx 2MB · recomendado 512×512px</p>
          <label className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg
                            border border-input bg-background hover:bg-muted cursor-pointer transition-colors">
            <Upload className="w-3 h-3" /> Subir logo
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) subirLogo(f); }}
            />
          </label>
        </div>
      </div>

      {/* Datos legales */}
      <Section title="Datos de la empresa">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Razón social *" error={errors.razonSocial?.message} span={2}>
            <input {...register('razonSocial')} placeholder="FibraNet S.A.C." className={inp(!!errors.razonSocial)} />
          </Field>
          <Field label="RUC *" error={errors.ruc?.message}>
            <input {...register('ruc')} placeholder="20123456789" className={cn(inp(!!errors.ruc), 'font-mono')} maxLength={11} />
          </Field>
          <Field label="Teléfono">
            <input {...register('telefono')} placeholder="+51 073 123456" className={inp()} />
          </Field>
          <Field label="Email" error={errors.email?.message} span={2}>
            <input {...register('email')} type="email" placeholder="contacto@fibranet.pe" className={inp(!!errors.email)} />
          </Field>
          <Field label="Dirección" span={2}>
            <input {...register('direccion')} placeholder="Av. Sánchez Cerro 1234, Piura" className={inp()} />
          </Field>
          <Field label="Sitio web" error={errors.websiteUrl?.message} span={2}>
            <input {...register('websiteUrl')} type="url" placeholder="https://fibranet.pe" className={inp(!!errors.websiteUrl)} />
          </Field>
        </div>
      </Section>

      {/* Facturación */}
      <Section title="Facturación y cobranza">
        <div className="grid grid-cols-3 gap-4">
          <Field label="Serie boleta" error={errors.serieBoleta?.message}>
            <input {...register('serieBoleta')} placeholder="B001" className={cn(inp(!!errors.serieBoleta), 'font-mono')} />
          </Field>
          <Field label="Serie factura" error={errors.serieFactura?.message}>
            <input {...register('serieFactura')} placeholder="F001" className={cn(inp(!!errors.serieFactura), 'font-mono')} />
          </Field>
          <Field label="Tasa IGV (0.18 = 18%)" error={errors.igvRate?.message}>
            <input type="number" step="0.01" min="0" max="1" {...register('igvRate')} className={inp(!!errors.igvRate)} />
          </Field>
          <Field label="Día de facturación (1-28)" error={errors.diaFacturacion?.message}>
            <input type="number" min={1} max={28} {...register('diaFacturacion')} className={inp(!!errors.diaFacturacion)} />
          </Field>
          <Field label="Días de gracia antes del corte" error={errors.diasGraciaCorte?.message}>
            <input type="number" min={0} max={30} {...register('diasGraciaCorte')} className={inp(!!errors.diasGraciaCorte)} />
          </Field>
        </div>
      </Section>

      {/* Notificaciones */}
      <Section title="Notificaciones automáticas">
        <div className="space-y-3">
          {[
            { name: 'notifWhatsappVencimiento', label: 'WhatsApp cuando una factura está por vencer', desc: 'Avisa 3 días antes y el día del vencimiento' },
            { name: 'notifWhatsappCorte', label: 'WhatsApp al cortar el servicio por mora', desc: 'Notifica al cliente cuando se suspende por deuda' },
          ].map(({ name, label, desc }) => (
            <label key={name} className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" {...register(name as any)} className="rounded mt-0.5" />
              <div>
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            </label>
          ))}
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
